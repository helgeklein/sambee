from __future__ import annotations

import hashlib
import json
import os
import shutil
import stat
import subprocess
from pathlib import Path

import pytest

SCRIPT_PATH = Path(__file__).resolve().parents[2] / ".github" / "scripts" / "verify_candidate_metadata_bundle.sh"


def _write_fake_crane(directory: Path) -> Path:
    crane_path = directory / "bin" / "crane"
    crane_path.parent.mkdir(parents=True, exist_ok=True)
    crane_path.write_text(
        """
#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import sys

manifests = json.loads(os.environ["FAKE_CRANE_MANIFESTS"])
command = sys.argv[1]

if command == "manifest":
    ref = sys.argv[2]
    sys.stdout.write(manifests[ref])
else:
    raise SystemExit(f"unsupported crane command: {command}")
""".strip()
        + "\n",
        encoding="utf-8",
    )
    crane_path.chmod(crane_path.stat().st_mode | stat.S_IEXEC)
    return crane_path.parent


def _write_fake_oras(directory: Path) -> Path:
    oras_path = directory / "bin" / "oras"
    oras_path.parent.mkdir(parents=True, exist_ok=True)
    oras_path.write_text(
        """
#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import pathlib
import sys

bundles = json.loads(os.environ["FAKE_ORAS_BUNDLES"])
command = sys.argv[1]

if command == "pull":
    ref = sys.argv[2]
    output_dir = pathlib.Path(sys.argv[sys.argv.index("--output") + 1])
    output_dir.mkdir(parents=True, exist_ok=True)
    for key, content in bundles.items():
        bundle_ref, relative_path = key.split("|", 1)
        if bundle_ref != ref:
            continue
        target_path = output_dir / relative_path
        target_path.parent.mkdir(parents=True, exist_ok=True)
        target_path.write_text(content, encoding="utf-8")
else:
    raise SystemExit(f"unsupported oras command: {command}")
""".strip()
        + "\n",
        encoding="utf-8",
    )
    oras_path.chmod(oras_path.stat().st_mode | stat.S_IEXEC)
    return oras_path.parent


def _sha256(content: str) -> str:
    return "sha256:" + hashlib.sha256(content.encode("utf-8")).hexdigest()


def _candidate_manifest(platform_digests: dict[str, str]) -> dict[str, object]:
    manifests: list[dict[str, object]] = []
    for platform, digest in platform_digests.items():
        os_name, architecture = platform.split("/", 1)
        manifests.append(
            {
                "digest": digest,
                "mediaType": "application/vnd.oci.image.manifest.v1+json",
                "platform": {"os": os_name, "architecture": architecture},
            }
        )
    return {"schemaVersion": 2, "manifests": manifests}


def _bundle_files(
    image_repository: str,
    image_digest: str,
    metadata_repository: str,
    metadata_tag: str,
    version: str,
    revision: str,
    source_url: str,
    platforms: dict[str, str],
    provenance_lines: list[str],
    sbom_contents: dict[str, str],
) -> dict[str, str]:
    checksums = {
        "provenance/intoto.jsonl": _sha256("\n".join(provenance_lines) + "\n"),
    }
    for relative_path, content in sbom_contents.items():
        checksums[relative_path] = _sha256(content)

    metadata = {
        "schema_version": 1,
        "bundle_type": "sambee.image-metadata",
        "image_repository": image_repository,
        "image_digest": image_digest,
        "metadata_repository": metadata_repository,
        "metadata_tag": metadata_tag,
        "version": version,
        "revision": revision,
        "source_url": source_url,
        "created": "2026-05-16T00:00:00Z",
        "platforms": [
            {
                "platform": platform,
                "manifest_digest": digest,
                "sbom_path": f"sbom/{platform.replace('/', '-')}.spdx.json",
            }
            for platform, digest in platforms.items()
        ],
        "provenance": {
            "path": "provenance/intoto.jsonl",
            "predicate_type_prefix": "https://slsa.dev/provenance/",
        },
        "checksums": checksums,
    }

    files = {
        "metadata.json": json.dumps(metadata, indent=2) + "\n",
        "provenance/intoto.jsonl": "\n".join(provenance_lines) + "\n",
    }
    files.update(sbom_contents)
    return files


def _run_script(
    path_dir: Path,
    image_ref: str,
    metadata_repository: str,
    expected_version: str,
    expected_revision: str,
    expected_source: str,
    manifests: dict[str, object],
    bundles: dict[str, str],
) -> subprocess.CompletedProcess[str]:
    env = os.environ.copy()
    env["PATH"] = f"{path_dir}:{env['PATH']}"
    env["FAKE_CRANE_MANIFESTS"] = json.dumps({key: json.dumps(value) for key, value in manifests.items()})
    env["FAKE_ORAS_BUNDLES"] = json.dumps(bundles)
    return subprocess.run(
        [
            "bash",
            str(SCRIPT_PATH),
            "--image-ref",
            image_ref,
            "--metadata-repository",
            metadata_repository,
            "--expected-version",
            expected_version,
            "--expected-revision",
            expected_revision,
            "--expected-source",
            expected_source,
        ],
        check=False,
        capture_output=True,
        text=True,
        env=env,
    )


def _base_case() -> tuple[str, str, str, str, dict[str, str], dict[str, object], dict[str, str]]:
    image_repository = "ghcr.io/example/sambee"
    image_digest = "sha256:" + "1" * 64
    metadata_repository = "ghcr.io/example/sambee-signatures"
    metadata_tag = f"sha256-{'1' * 64}.meta"
    version = "0.7.0-beta.1"
    revision = "abcdef1234567890abcdef1234567890abcdef12"
    source_url = "https://github.com/example/sambee"
    platform_digests = {
        "linux/amd64": "sha256:" + "a" * 64,
        "linux/arm64": "sha256:" + "b" * 64,
    }

    provenance_lines = [
        json.dumps(
            {
                "predicateType": "https://slsa.dev/provenance/v1",
                "subject": [{"digest": {"sha256": platform_digests["linux/amd64"].removeprefix("sha256:")}}],
            }
        ),
        json.dumps(
            {
                "predicateType": "https://slsa.dev/provenance/v1",
                "subject": [{"digest": {"sha256": platform_digests["linux/arm64"].removeprefix("sha256:")}}],
            }
        ),
    ]
    sbom_contents = {
        "sbom/linux-amd64.spdx.json": json.dumps({"spdxVersion": "SPDX-2.3", "name": "amd64"}) + "\n",
        "sbom/linux-arm64.spdx.json": json.dumps({"spdxVersion": "SPDX-2.3", "name": "arm64"}) + "\n",
    }
    bundle_files = _bundle_files(
        image_repository=image_repository,
        image_digest=image_digest,
        metadata_repository=metadata_repository,
        metadata_tag=metadata_tag,
        version=version,
        revision=revision,
        source_url=source_url,
        platforms=platform_digests,
        provenance_lines=provenance_lines,
        sbom_contents=sbom_contents,
    )

    bundles = {f"{metadata_repository}:{metadata_tag}|{relative_path}": content for relative_path, content in bundle_files.items()}
    manifests = {f"{image_repository}@{image_digest}": _candidate_manifest(platform_digests)}
    return image_repository, image_digest, metadata_repository, version, revision, source_url, manifests, bundles


@pytest.mark.unit
@pytest.mark.skipif(shutil.which("jq") is None, reason="jq is required for shell verifier tests")
def test_verifier_accepts_complete_bundle(tmp_path: Path) -> None:
    image_repository, image_digest, metadata_repository, version, revision, source_url, manifests, bundles = _base_case()
    path_dir = _write_fake_crane(tmp_path)
    _write_fake_oras(tmp_path)

    result = _run_script(
        path_dir=path_dir,
        image_ref=f"{image_repository}@{image_digest}",
        metadata_repository=metadata_repository,
        expected_version=version,
        expected_revision=revision,
        expected_source=source_url,
        manifests=manifests,
        bundles=bundles,
    )

    assert result.returncode == 0, result.stderr


@pytest.mark.unit
@pytest.mark.skipif(shutil.which("jq") is None, reason="jq is required for shell verifier tests")
def test_verifier_fails_when_metadata_tag_does_not_match_candidate_digest(tmp_path: Path) -> None:
    image_repository, image_digest, metadata_repository, version, revision, source_url, manifests, bundles = _base_case()
    wrong_tag = f"sha256-{'2' * 64}.meta"
    rebundled = {key.replace(f"sha256-{'1' * 64}.meta", wrong_tag): value for key, value in bundles.items()}
    path_dir = _write_fake_crane(tmp_path)
    _write_fake_oras(tmp_path)

    result = _run_script(
        path_dir=path_dir,
        image_ref=f"{image_repository}@{image_digest}",
        metadata_repository=metadata_repository,
        expected_version=version,
        expected_revision=revision,
        expected_source=source_url,
        manifests=manifests,
        bundles=rebundled,
    )

    assert result.returncode != 0


@pytest.mark.unit
@pytest.mark.skipif(shutil.which("jq") is None, reason="jq is required for shell verifier tests")
def test_verifier_fails_when_sbom_file_is_missing(tmp_path: Path) -> None:
    image_repository, image_digest, metadata_repository, version, revision, source_url, manifests, bundles = _base_case()
    bundles = {key: value for key, value in bundles.items() if not key.endswith("sbom/linux-arm64.spdx.json")}
    path_dir = _write_fake_crane(tmp_path)
    _write_fake_oras(tmp_path)

    result = _run_script(
        path_dir=path_dir,
        image_ref=f"{image_repository}@{image_digest}",
        metadata_repository=metadata_repository,
        expected_version=version,
        expected_revision=revision,
        expected_source=source_url,
        manifests=manifests,
        bundles=bundles,
    )

    assert result.returncode != 0
    assert "missing required file" in result.stderr


@pytest.mark.unit
@pytest.mark.skipif(shutil.which("jq") is None, reason="jq is required for shell verifier tests")
def test_verifier_fails_when_provenance_is_missing_for_one_platform(tmp_path: Path) -> None:
    image_repository, image_digest, metadata_repository, version, revision, source_url, manifests, bundles = _base_case()
    metadata_key = next(key for key in bundles if key.endswith("metadata.json"))
    provenance_key = next(key for key in bundles if key.endswith("provenance/intoto.jsonl"))
    metadata = json.loads(bundles[metadata_key])
    lines = bundles[provenance_key].strip().splitlines()[:1]
    bundles[provenance_key] = "\n".join(lines) + "\n"
    metadata["checksums"]["provenance/intoto.jsonl"] = _sha256(bundles[provenance_key])
    bundles[metadata_key] = json.dumps(metadata, indent=2) + "\n"

    path_dir = _write_fake_crane(tmp_path)
    _write_fake_oras(tmp_path)
    result = _run_script(
        path_dir=path_dir,
        image_ref=f"{image_repository}@{image_digest}",
        metadata_repository=metadata_repository,
        expected_version=version,
        expected_revision=revision,
        expected_source=source_url,
        manifests=manifests,
        bundles=bundles,
    )

    assert result.returncode != 0
    assert "No provenance statement found for platform linux/arm64" in result.stderr


@pytest.mark.unit
@pytest.mark.skipif(shutil.which("jq") is None, reason="jq is required for shell verifier tests")
def test_verifier_fails_when_revision_or_source_mismatch(tmp_path: Path) -> None:
    image_repository, image_digest, metadata_repository, version, revision, source_url, manifests, bundles = _base_case()
    path_dir = _write_fake_crane(tmp_path)
    _write_fake_oras(tmp_path)
    result = _run_script(
        path_dir=path_dir,
        image_ref=f"{image_repository}@{image_digest}",
        metadata_repository=metadata_repository,
        expected_version=version,
        expected_revision=revision,
        expected_source="https://github.com/example/other",
        manifests=manifests,
        bundles=bundles,
    )

    assert result.returncode != 0
    assert "Source URL mismatch" in result.stderr


@pytest.mark.unit
@pytest.mark.skipif(shutil.which("jq") is None, reason="jq is required for shell verifier tests")
def test_verifier_fails_when_provenance_subject_digest_is_unexpected(tmp_path: Path) -> None:
    image_repository, image_digest, metadata_repository, version, revision, source_url, manifests, bundles = _base_case()
    metadata_key = next(key for key in bundles if key.endswith("metadata.json"))
    provenance_key = next(key for key in bundles if key.endswith("provenance/intoto.jsonl"))
    lines = bundles[provenance_key].strip().splitlines()
    first_statement = json.loads(lines[0])
    first_statement["subject"] = [{"digest": {"sha256": "f" * 64}}]
    bundles[provenance_key] = json.dumps(first_statement) + "\n" + lines[1] + "\n"
    metadata = json.loads(bundles[metadata_key])
    metadata["checksums"]["provenance/intoto.jsonl"] = _sha256(bundles[provenance_key])
    bundles[metadata_key] = json.dumps(metadata, indent=2) + "\n"

    path_dir = _write_fake_crane(tmp_path)
    _write_fake_oras(tmp_path)
    result = _run_script(
        path_dir=path_dir,
        image_ref=f"{image_repository}@{image_digest}",
        metadata_repository=metadata_repository,
        expected_version=version,
        expected_revision=revision,
        expected_source=source_url,
        manifests=manifests,
        bundles=bundles,
    )

    assert result.returncode != 0
    assert "unexpected subject digest" in result.stderr


@pytest.mark.unit
@pytest.mark.skipif(shutil.which("jq") is None, reason="jq is required for shell verifier tests")
def test_verifier_fails_when_checksum_does_not_match(tmp_path: Path) -> None:
    image_repository, image_digest, metadata_repository, version, revision, source_url, manifests, bundles = _base_case()
    metadata_key = next(key for key in bundles if key.endswith("metadata.json"))
    metadata = json.loads(bundles[metadata_key])
    metadata["checksums"]["sbom/linux-amd64.spdx.json"] = "sha256:" + "0" * 64
    bundles[metadata_key] = json.dumps(metadata, indent=2) + "\n"

    path_dir = _write_fake_crane(tmp_path)
    _write_fake_oras(tmp_path)
    result = _run_script(
        path_dir=path_dir,
        image_ref=f"{image_repository}@{image_digest}",
        metadata_repository=metadata_repository,
        expected_version=version,
        expected_revision=revision,
        expected_source=source_url,
        manifests=manifests,
        bundles=bundles,
    )

    assert result.returncode != 0
    assert "Checksum for sbom/linux-amd64.spdx.json mismatch" in result.stderr


@pytest.mark.unit
@pytest.mark.skipif(shutil.which("jq") is None, reason="jq is required for shell verifier tests")
def test_verifier_fails_when_required_checksum_is_missing(tmp_path: Path) -> None:
    image_repository, image_digest, metadata_repository, version, revision, source_url, manifests, bundles = _base_case()
    metadata_key = next(key for key in bundles if key.endswith("metadata.json"))
    metadata = json.loads(bundles[metadata_key])
    del metadata["checksums"]["sbom/linux-arm64.spdx.json"]
    bundles[metadata_key] = json.dumps(metadata, indent=2) + "\n"

    path_dir = _write_fake_crane(tmp_path)
    _write_fake_oras(tmp_path)
    result = _run_script(
        path_dir=path_dir,
        image_ref=f"{image_repository}@{image_digest}",
        metadata_repository=metadata_repository,
        expected_version=version,
        expected_revision=revision,
        expected_source=source_url,
        manifests=manifests,
        bundles=bundles,
    )

    assert result.returncode != 0
    assert "checksums is missing required bundle file: sbom/linux-arm64.spdx.json" in result.stderr


@pytest.mark.unit
@pytest.mark.skipif(shutil.which("jq") is None, reason="jq is required for shell verifier tests")
def test_verifier_fails_when_checksum_entry_is_unexpected(tmp_path: Path) -> None:
    image_repository, image_digest, metadata_repository, version, revision, source_url, manifests, bundles = _base_case()
    metadata_key = next(key for key in bundles if key.endswith("metadata.json"))
    metadata = json.loads(bundles[metadata_key])
    metadata["checksums"]["metadata.json"] = "sha256:" + "0" * 64
    bundles[metadata_key] = json.dumps(metadata, indent=2) + "\n"

    path_dir = _write_fake_crane(tmp_path)
    _write_fake_oras(tmp_path)
    result = _run_script(
        path_dir=path_dir,
        image_ref=f"{image_repository}@{image_digest}",
        metadata_repository=metadata_repository,
        expected_version=version,
        expected_revision=revision,
        expected_source=source_url,
        manifests=manifests,
        bundles=bundles,
    )

    assert result.returncode != 0
    assert "Checksum entry references unexpected bundle file: metadata.json" in result.stderr
