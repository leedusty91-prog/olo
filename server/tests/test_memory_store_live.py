import sqlite3

from olo.memory.voicemem_api import ApiVoiceMemAdapter, list_live_memories


class Store:
    def __init__(self, path):
        self.path = path
        c = sqlite3.connect(path)
        c.execute("CREATE TABLE memories (id TEXT, user_id TEXT, content TEXT, created_at TEXT, updated_at TEXT)")
        c.execute("CREATE TABLE entity_memory_links (id TEXT, memory_id TEXT)")
        c.executemany("INSERT INTO memories VALUES (?,?,?,?,?)", [
            ("m1", "u", "用户家的猫叫年糕", "2026-10-22", ""), ("m2", "u", "用户在咖啡豆公司上班", "2026-10-22", ""),
        ])
        c.execute("INSERT INTO entity_memory_links VALUES ('l1','m1')")
        c.commit()

    def _conn(self):
        return sqlite3.connect(self.path)


class VS:
    def __init__(self, entries):
        self.entries = entries

    def list_entries(self, *, user_id):
        return self.entries


class Repo:
    def __init__(self, store, entries=()):
        self.cognitive_store = store
        self.vector_store = VS(list(entries))
        self.deleted, self.updated = [], []

    def load_json_store(self):
        return {"count": 0, "results": []}

    def update_memory(self, mid, text, user_id=None):
        self.updated.append((mid, text, user_id))
        return True

    def delete_memory(self, mid):
        self.deleted.append(mid)
        return True


def _adapter(repo):
    a = ApiVoiceMemAdapter.__new__(ApiVoiceMemAdapter)
    a._s = type("S", (), {"user_id": "u"})()
    a._repo = lambda: repo
    return a


def test_lists_mem0_entries_and_skips_assistant_rows(tmp_path):
    repo = Repo(Store(tmp_path / "c.sqlite"), [
        {"id": "m1", "text": "用户家的猫叫年糕", "date": "2026-10-22", "role": "user"},
        {"id": "x", "text": "olo 说的话", "date": "2026-10-22", "role": "assistant"},
    ])
    assert [m["id"] for m in list_live_memories(repo, "u")] == ["m1"]


def test_falls_back_to_cognitive_sqlite_when_mem0_and_mirror_empty(tmp_path):
    repo = Repo(Store(tmp_path / "c.sqlite"))
    got = list_live_memories(repo, "u")
    assert [m["text"] for m in got] == ["用户家的猫叫年糕", "用户在咖啡豆公司上班"]


def test_update_and_delete_reach_mem0_and_cognitive_rows(tmp_path):
    store = Store(tmp_path / "c.sqlite")
    repo = Repo(store)
    a = _adapter(repo)
    assert a.update_memory("m2", "用户在一家咖啡豆小公司上班，常加班")
    assert repo.updated == [("m2", "用户在一家咖啡豆小公司上班，常加班", "u")]
    assert a.delete_memory("m1") and repo.deleted == ["m1"]
    c = sqlite3.connect(store.path)
    assert c.execute("select id, content from memories").fetchall() == [("m2", "用户在一家咖啡豆小公司上班，常加班")]
    assert c.execute("select count(*) from entity_memory_links").fetchone()[0] == 0
    assert [m["id"] for m in a.list_memories()] == ["m2"]
