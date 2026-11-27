CREATE TABLE summaries (
    kind TEXT NOT NULL, id TEXT NOT NULL, summary TEXT NOT NULL,
    PRIMARY KEY(kind, id),
    FOREIGN KEY(kind, id) REFERENCES records(kind, id) ON DELETE CASCADE
) STRICT, WITHOUT ROWID;
