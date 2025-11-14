"""
Shared pytest fixtures for Sambee tests.
Provides test database, test client, authentication, and mock SMB backend.
"""

import os
import uuid
from typing import Generator

import pytest
from app.core.security import create_access_token, get_password_hash
from app.db.database import get_session
from app.main import app
from app.models.connection import Connection
from app.models.user import User
from fastapi.testclient import TestClient
from sqlmodel import Session, SQLModel, create_engine
from sqlmodel.pool import StaticPool


@pytest.fixture(name="test_db_path", scope="session")
def test_db_path_fixture(tmp_path_factory) -> Generator[str, None, None]:
    """Create a temporary database file for testing.

    Uses session scope and tmp_path_factory to ensure each pytest-xdist
    worker gets its own database file to avoid race conditions.
    """
    # Get worker-specific temp directory (automatically handles xdist workers)
    temp_dir = tmp_path_factory.mktemp("test_db")
    path = str(temp_dir / f"test_{uuid.uuid4().hex}.db")
    yield path
    # Cleanup
    try:
        os.unlink(path)
    except OSError:
        pass


@pytest.fixture(name="engine", scope="session")
def engine_fixture(test_db_path: str):
    """Create a test database engine with in-memory pool.

    Uses session scope to share the database across all tests in a worker,
    avoiding the overhead of recreating tables for each test.
    """
    from app.core.config import settings

    # Use SQLite with shared cache for multi-threaded access
    engine = create_engine(
        f"sqlite:///{test_db_path}",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
        echo=settings.debug,  # Match production engine settings
    )
    SQLModel.metadata.create_all(engine)
    yield engine
    # Cleanup: dispose of the engine to close all connections
    engine.dispose()


@pytest.fixture(scope="session", autouse=True)
def patch_db_engine(engine):
    """Patch the global database engine to use test engine.

    This ensures that any code importing from app.db.database or app.main
    gets the test engine instead of the production one.
    """
    import app.db.database as db_module
    import app.main as main_module

    # Patch database module
    original_db_engine = db_module.engine
    db_module.engine = engine

    # Patch main module (used in lifespan startup)
    original_main_engine = main_module.engine
    main_module.engine = engine

    yield

    # Restore original engines after tests
    db_module.engine = original_db_engine
    main_module.engine = original_main_engine


@pytest.fixture(name="session")
def session_fixture(engine) -> Generator[Session, None, None]:
    """Create a test database session with transaction rollback.

    Each test runs in its own transaction which is rolled back after the test,
    ensuring a clean state for the next test while sharing the same database schema.
    """
    connection = engine.connect()
    transaction = connection.begin()
    session = Session(bind=connection)

    yield session

    # Rollback the transaction to undo all changes made during the test
    session.close()
    transaction.rollback()
    connection.close()


@pytest.fixture(name="client")
def client_fixture(session: Session) -> Generator[TestClient, None, None]:
    """Create a test client with database session override."""

    def get_session_override():
        return session

    app.dependency_overrides[get_session] = get_session_override
    client = TestClient(app)
    yield client
    app.dependency_overrides.clear()


@pytest.fixture(name="admin_user")
def admin_user_fixture(session: Session) -> User:
    """Create a test admin user."""
    user = User(
        username="testadmin",
        password_hash=get_password_hash("adminpass123"),
        is_admin=True,
    )
    session.add(user)
    session.commit()
    session.refresh(user)
    return user


@pytest.fixture(name="regular_user")
def regular_user_fixture(session: Session) -> User:
    """Create a test regular (non-admin) user."""
    user = User(
        username="testuser",
        password_hash=get_password_hash("userpass123"),
        is_admin=False,
    )
    session.add(user)
    session.commit()
    session.refresh(user)
    return user


@pytest.fixture(name="admin_token")
def admin_token_fixture(admin_user: User) -> str:
    """Create an access token for the admin user."""
    return create_access_token(data={"sub": admin_user.username})


@pytest.fixture(name="user_token")
def user_token_fixture(regular_user: User) -> str:
    """Create an access token for the regular user."""
    return create_access_token(data={"sub": regular_user.username})


@pytest.fixture(name="auth_headers_admin")
def auth_headers_admin_fixture(admin_token: str) -> dict:
    """Create authorization headers for admin user."""
    return {"Authorization": f"Bearer {admin_token}"}


@pytest.fixture(name="auth_headers_user")
def auth_headers_user_fixture(user_token: str) -> dict:
    """Create authorization headers for regular user."""
    return {"Authorization": f"Bearer {user_token}"}


@pytest.fixture(name="test_connection")
def test_connection_fixture(session: Session) -> Connection:
    """Create a test SMB connection."""
    from app.core.security import encrypt_password

    connection = Connection(
        id=uuid.uuid4(),
        name="Test SMB Server",
        host="test-server.local",
        share_name="testshare",
        username="smbuser",
        password_encrypted=encrypt_password("smbpass123"),
        port=445,
    )
    session.add(connection)
    session.commit()
    session.refresh(connection)
    return connection


@pytest.fixture(name="multiple_connections")
def multiple_connections_fixture(session: Session) -> list[Connection]:
    """Create multiple test SMB connections."""
    from app.core.security import encrypt_password

    connections = [
        Connection(
            id=uuid.uuid4(),
            name=f"Test Server {i}",
            host=f"server{i}.local",
            share_name=f"share{i}",
            username=f"user{i}",
            password_encrypted=encrypt_password(f"pass{i}"),
            port=445,
        )
        for i in range(1, 4)
    ]
    for conn in connections:
        session.add(conn)
    session.commit()
    for conn in connections:
        session.refresh(conn)
    return connections
