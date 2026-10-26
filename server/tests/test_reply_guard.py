from olo.memory.reply_guard import install


class VS:
    def __init__(self):
        self.rows = {"u1": ("user", "用户的猫叫年糕"), "a1": ("assistant", "年糕这是嫌你耳机线太结实了")}
        self._mem0 = self
        self.updated = []

    def get(self, mid):
        role, text = self.rows[mid]
        return {"id": mid, "memory": text, "role": role}

    def list_entries(self, *, user_id):
        return [{"id": k, "text": t, "role": r} for k, (r, t) in self.rows.items()]

    def existing_for_extractor(self, user_id, *, limit=50):
        return [{"id": k, "text": t} for k, (_, t) in self.rows.items()]

    def update_memory(self, mid, text, **kw):
        self.updated.append(mid)
        return True


class Repo:
    def __init__(self):
        self._vector_store = VS()

    @property
    def vector_store(self):
        return self._vector_store

    def existing_for_extractor(self, *, user_id, limit=None):
        return [{"id": "u1", "text": "用户的猫叫年糕"}, {"id": "a1", "text": "年糕这是嫌你耳机线太结实了"}]


def test_extractor_never_sees_reply_rows_and_cannot_rewrite_them():
    repo = Repo()
    assert install(repo) and not install(repo)
    assert [r["id"] for r in repo.existing_for_extractor(user_id="u")] == ["u1"]
    assert [r["id"] for r in repo.vector_store.existing_for_extractor("u")] == ["u1"]
    assert repo.vector_store.update_memory("a1", "用户在天台") is False
    assert repo.vector_store.update_memory("u1", "用户的猫叫年糕，咬断了耳机线") is True
    assert repo.vector_store.updated == ["u1"]
