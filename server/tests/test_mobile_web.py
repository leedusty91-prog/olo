import importlib
import os


def test_pixel_web_is_app_and_mobile_export_at_app_mobile(tmp_path, monkeypatch):
    (tmp_path / "index.html").write_text("<div id=root>mobile</div>")
    monkeypatch.setenv("OLO_MOBILE_WEB_DIR", str(tmp_path))
    import olo.main as main

    try:
        m = importlib.reload(main)
        from fastapi.testclient import TestClient

        c = TestClient(m.app)
        assert "mobile" not in c.get("/app/").text
        assert c.get("/app/app.js").status_code == 200
        assert "mobile" in c.get("/app-mobile/").text
        assert c.get("/app-classic/app.js").status_code == 200
        assert "OLO_CONFIG" in c.get("/app/config.js").text
        assert "OLO_CONFIG" in c.get("/app-classic/config.js").text
    finally:
        monkeypatch.setenv("OLO_MOBILE_WEB_DIR", "")
        importlib.reload(main)
