import sys
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path

import pytest

SCRIPT = Path(__file__).parents[2] / "scripts/extract-pyvips-wheel-requirement.py"
SPEC = spec_from_file_location("extract_pyvips_wheel_requirement", SCRIPT)
assert SPEC and SPEC.loader
MODULE = module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)

PYVIPS_HASH = "a" * 64


def test_extracts_one_hash_locked_pyvips_requirement(tmp_path: Path) -> None:
    lockfile = tmp_path / "requirements.lock.txt"
    lockfile.write_text(
        """fastapi==1.0.0 \\
    --hash=sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
pyvips==3.1.1 \\
    --hash=sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
    # via -r requirements.txt
""",
        encoding="utf-8",
    )

    assert MODULE.extract_pyvips_requirement(lockfile) == (f"pyvips==3.1.1 \\\n    --hash=sha256:{PYVIPS_HASH}\n")


def test_extracts_a_pyvips_requirement_with_multiple_hashes(tmp_path: Path) -> None:
    lockfile = tmp_path / "requirements.lock.txt"
    lockfile.write_text(
        """pyvips==3.1.1 \\
    --hash=sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \\
    --hash=sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
""",
        encoding="utf-8",
    )

    assert MODULE.extract_pyvips_requirement(lockfile) == (
        "pyvips==3.1.1 \\\n"
        f"    --hash=sha256:{PYVIPS_HASH} \\\n"
        "    --hash=sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\n"
    )


@pytest.mark.parametrize(
    "lockfile_contents, message",
    [
        ("pyvips==3.1.1\n", "must include a SHA-256 hash"),
        ("", "found 0"),
        (
            """pyvips==3.1.1 \\
    --hash=sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
pyvips==3.1.2 \\
    --hash=sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
""",
            "found 2",
        ),
    ],
)
def test_rejects_missing_or_ambiguous_pyvips_requirement(tmp_path: Path, lockfile_contents: str, message: str) -> None:
    lockfile = tmp_path / "requirements.lock.txt"
    lockfile.write_text(lockfile_contents, encoding="utf-8")

    with pytest.raises(ValueError, match=message):
        MODULE.extract_pyvips_requirement(lockfile)
