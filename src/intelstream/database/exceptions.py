class DatabaseError(Exception):
    """Base exception for database operations."""


class DuplicateSourceError(DatabaseError):
    """Raised when trying to add a source with an existing identifier."""

    def __init__(self, identifier: str) -> None:
        self.identifier = identifier
        super().__init__(f"Source with identifier '{identifier}' already exists")


class DuplicateContentError(DatabaseError):
    """Raised when trying to add content with an existing external_id."""

    def __init__(self, external_id: str) -> None:
        self.external_id = external_id
        super().__init__(f"Content with external_id '{external_id}' already exists")


class DatabaseConnectionError(DatabaseError):
    """Raised when a database connection or operational error occurs."""


class SourceNotFoundError(DatabaseError):
    """Raised when a source cannot be found."""

    def __init__(self, identifier: str) -> None:
        self.identifier = identifier
        super().__init__(f"Source with identifier '{identifier}' not found")
