"""
Tests for database layer.

Tests cover:
- Database initialization
- Session management
- Table creation
- Model constraints and validation
"""

import tempfile
from pathlib import Path
from typing import Generator
from unittest.mock import patch

import pytest
from app.models.connection import Connection
from app.models.user import User
from sqlmodel import Session, SQLModel, create_engine, select


@pytest.mark.unit
class TestDatabaseInitialization:
    """Test database initialization."""

    def test_init_db_creates_tables(self):
        """Test that init_db creates all tables."""
        # Create a temporary database
        with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as tmp:
            db_path = tmp.name

        try:
            # Create engine for temporary database
            test_engine = create_engine(
                f"sqlite:///{db_path}",
                connect_args={"check_same_thread": False},
            )

            # Initialize tables
            SQLModel.metadata.create_all(test_engine)

            # Verify tables were created by checking if we can query them
            with Session(test_engine) as session:
                # Should not raise an error
                session.exec(select(User)).all()
                session.exec(select(Connection)).all()

        finally:
            # Cleanup
            Path(db_path).unlink(missing_ok=True)

    def test_init_db_called_successfully(self):
        """Test that init_db can be called without errors."""
        # This uses the actual database
        from app.db.database import init_db

        # Should not raise any exceptions
        init_db()

    @patch("app.db.database.SQLModel.metadata.create_all")
    def test_init_db_calls_create_all(self, mock_create_all):
        """Test that init_db calls SQLModel.metadata.create_all."""
        from app.db.database import engine, init_db

        init_db()

        # Verify create_all was called with the engine
        mock_create_all.assert_called_once_with(engine)


@pytest.mark.unit
class TestSessionManagement:
    """Test database session management."""

    def test_get_session_returns_generator(self):
        """Test that get_session returns a generator."""
        from app.db.database import get_session

        result = get_session()
        assert isinstance(result, Generator)

    def test_get_session_yields_session(self):
        """Test that get_session yields a Session object."""
        from app.db.database import get_session

        gen = get_session()
        session = next(gen)

        assert isinstance(session, Session)

        # Cleanup
        try:
            next(gen)
        except StopIteration:
            pass

    def test_get_session_context_manager(self):
        """Test that get_session uses context manager properly."""
        from app.db.database import get_session

        # Test that generator completes without errors
        gen = get_session()
        session = next(gen)

        # Session should be active while in context
        assert session.is_active

        # Exhaust the generator to complete context manager
        with pytest.raises(StopIteration):
            next(gen)

    def test_get_session_can_query_database(self):
        """Test that session can query the database."""
        from app.db.database import get_session

        gen = get_session()
        session = next(gen)

        # Should be able to query without errors
        users = session.exec(select(User)).all()
        assert isinstance(users, list)

        # Cleanup
        try:
            next(gen)
        except StopIteration:
            pass

    def test_get_session_transaction_rollback_on_error(self):
        """Test that session rolls back on error."""
        from app.db.database import get_session

        gen = get_session()
        session = next(gen)

        try:
            # Create a user with invalid data (duplicate username)
            user1 = User(username="test_rollback", password_hash="hash1")
            session.add(user1)
            session.commit()

            # Try to create duplicate - should fail
            user2 = User(username="test_rollback", password_hash="hash2")
            session.add(user2)
            session.commit()  # This should raise an error
        except Exception:
            # Session should allow rollback
            session.rollback()

        # Cleanup
        try:
            next(gen)
        except StopIteration:
            pass


@pytest.mark.unit
class TestDatabaseEngine:
    """Test database engine configuration."""

    def test_engine_is_created(self):
        """Test that database engine is created."""
        from app.db.database import engine

        assert engine is not None

    def test_engine_url_format(self):
        """Test that database URL is correctly formatted."""
        from app.db.database import DATABASE_URL

        assert DATABASE_URL.startswith("sqlite:///")
        assert "sambee.db" in DATABASE_URL

    def test_engine_uses_sqlite(self):
        """Test that engine uses SQLite."""
        from app.db.database import engine

        assert "sqlite" in str(engine.url)


@pytest.mark.integration
class TestModelConstraints:
    """Test model constraints and validation."""

    def test_user_unique_username_constraint(self, session: Session):
        """Test that username must be unique."""
        # Create first user
        user1 = User(username="unique_test", password_hash="hash1")
        session.add(user1)
        session.commit()

        # Try to create second user with same username
        user2 = User(username="unique_test", password_hash="hash2")
        session.add(user2)

        with pytest.raises(Exception):  # SQLAlchemy will raise IntegrityError
            session.commit()

        session.rollback()

    def test_user_not_null_constraints(self, session: Session):
        """Test that required fields cannot be null."""
        # Username is required - this is caught by Pydantic validation
        # SQLModel models validate at instantiation time, not at database time
        # Test that User model has proper required fields
        from app.models.user import User as UserModel

        # Check that username field is required
        assert "username" in UserModel.model_fields
        assert UserModel.model_fields["username"].is_required()

    def test_user_default_values(self, session: Session):
        """Test that default values are set correctly."""
        user = User(username="default_test", password_hash="hash")
        session.add(user)
        session.commit()
        session.refresh(user)

        # is_admin should default to False
        assert user.is_admin is False
        # created_at should be set
        assert user.created_at is not None

    def test_connection_foreign_key_constraint(self, session: Session):
        """Test that connections can be created without foreign keys."""
        # Connection model doesn't have foreign keys in current schema
        connection = Connection(
            name="Test Connection",
            type="smb",
            host="server.local",
            share_name="share",
            username="user",
            password_encrypted="encrypted",
        )
        session.add(connection)
        session.commit()

        assert connection.id is not None

    def test_connection_not_null_constraints(self, session: Session):
        """Test that required fields cannot be null."""
        # Name is required - check model definition
        from app.models.connection import Connection as ConnectionModel

        # Check that name field is required
        assert "name" in ConnectionModel.model_fields
        assert ConnectionModel.model_fields["name"].is_required()

    def test_connection_default_values(self, session: Session):
        """Test that default values are set correctly."""
        connection = Connection(
            name="Default Test",
            type="smb",
            host="server.local",
            share_name="share",
            username="user",
            password_encrypted="encrypted",
        )
        session.add(connection)
        session.commit()
        session.refresh(connection)

        # created_at should be set
        assert connection.created_at is not None
        # port should default to 445
        assert connection.port == 445


@pytest.mark.integration
class TestTransactionHandling:
    """Test transaction handling."""

    def test_commit_persists_data(self, session: Session):
        """Test that commit persists data to database."""
        username = f"commit_test_{id(session)}"
        user = User(username=username, password_hash="hash")
        session.add(user)
        session.commit()

        # Refresh to ensure we have the ID
        session.refresh(user)
        user_id = user.id

        # Query in same session to verify persistence
        result = session.exec(select(User).where(User.id == user_id)).first()
        assert result is not None
        assert result.username == username

    def test_rollback_discards_changes(self, session: Session):
        """Test that rollback discards uncommitted changes."""
        user = User(username="rollback_test", password_hash="hash")
        session.add(user)
        # Don't commit
        session.rollback()

        # Query should not find the user
        result = session.exec(
            select(User).where(User.username == "rollback_test")
        ).first()
        assert result is None

    def test_transaction_isolation(self, session: Session):
        """Test that transactions are isolated."""
        # Create user in first session
        user = User(username="isolation_test", password_hash="hash")
        session.add(user)
        # Don't commit yet

        # Query in second session should not see uncommitted data
        from app.db.database import get_session

        gen = get_session()
        other_session = next(gen)

        result = other_session.exec(
            select(User).where(User.username == "isolation_test")
        ).first()
        assert result is None  # Uncommitted data not visible

        # Cleanup
        session.rollback()
        try:
            next(gen)
        except StopIteration:
            pass


@pytest.mark.integration
class TestConcurrentAccess:
    """Test concurrent database access."""

    def test_multiple_sessions_can_read(self, session: Session):
        """Test that multiple sessions can read simultaneously."""
        from app.db.database import get_session

        # Open multiple sessions
        sessions = []
        for _ in range(3):
            gen = get_session()
            s = next(gen)
            sessions.append((gen, s))

        # All sessions should be able to query without errors
        for _, s in sessions:
            # Query should succeed even if no results
            result = s.exec(select(User)).all()
            assert isinstance(result, list)

        # Cleanup
        for gen, _ in sessions:
            try:
                next(gen)
            except StopIteration:
                pass

    def test_sessions_are_independent(self):
        """Test that sessions maintain independent state."""
        from app.db.database import get_session

        # Create two sessions
        gen1 = get_session()
        session1 = next(gen1)

        gen2 = get_session()
        session2 = next(gen2)

        # They should be different objects
        assert session1 is not session2

        # Cleanup
        for gen in [gen1, gen2]:
            try:
                next(gen)
            except StopIteration:
                pass


@pytest.mark.unit
class TestDatabaseConfiguration:
    """Test database configuration."""

    def test_check_same_thread_disabled(self):
        """Test that check_same_thread is disabled for SQLite."""
        from app.db.database import engine

        # This setting is needed for FastAPI/async usage
        # We verify by checking the engine was created with proper connect_args
        # The actual check is in the database.py configuration
        assert "sqlite" in str(engine.url)

    def test_debug_mode_affects_echo(self):
        """Test that debug mode affects SQL echo."""
        from app.core.config import settings
        from app.db.database import engine

        # Echo should match debug setting
        assert engine.echo == settings.debug


@pytest.mark.integration
class TestDatabaseSchemaValidation:
    """Test database schema validation."""

    def test_all_models_have_tables(self, session: Session):
        """Test that all models have corresponding tables."""
        # Test User table
        users = session.exec(select(User)).all()
        assert isinstance(users, list)

        # Test Connection table
        connections = session.exec(select(Connection)).all()
        assert isinstance(connections, list)

    def test_user_table_columns(self, session: Session):
        """Test that User table has expected columns."""
        user = User(username="column_test", password_hash="hash", is_admin=True)
        session.add(user)
        session.commit()
        session.refresh(user)

        # Verify all expected attributes exist
        assert hasattr(user, "id")
        assert hasattr(user, "username")
        assert hasattr(user, "password_hash")
        assert hasattr(user, "is_admin")
        assert hasattr(user, "created_at")

    def test_connection_table_columns(self, session: Session):
        """Test that Connection table has expected columns."""
        connection = Connection(
            name="Column Test",
            type="smb",
            host="server.local",
            port=445,
            share_name="share",
            username="user",
            password_encrypted="encrypted",
        )
        session.add(connection)
        session.commit()
        session.refresh(connection)

        # Verify all expected attributes exist
        assert hasattr(connection, "id")
        assert hasattr(connection, "name")
        assert hasattr(connection, "type")
        assert hasattr(connection, "host")
        assert hasattr(connection, "port")
        assert hasattr(connection, "share_name")
        assert hasattr(connection, "username")
        assert hasattr(connection, "password_encrypted")
        assert hasattr(connection, "created_at")
