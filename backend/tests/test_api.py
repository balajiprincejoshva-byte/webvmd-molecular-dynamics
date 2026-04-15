from fastapi.testclient import TestClient
from app.main import app


client = TestClient(app)


def test_health():
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.json().get("status") == "ok"


def test_list_datasets():
    r = client.get("/api/datasets")
    assert r.status_code == 200
    data = r.json()
    assert "datasets" in data
    # at least our sample generator should supply datasets after startup


def test_frame_binary_and_metadata():
    r = client.get("/api/datasets")
    assert r.status_code == 200
    ds = r.json().get("datasets", [])
    if not ds:
        return
    dataset_id = ds[0]["id"]
    md = client.get(f"/api/datasets/{dataset_id}/metadata")
    assert md.status_code == 200
    n_frames = md.json().get("n_frames", 0)
    if n_frames > 0:
        rb = client.get(f"/api/datasets/{dataset_id}/frames/0?binary=true")
        assert rb.status_code == 200
        assert rb.content is not None


def test_register_and_benchmark_remote():
    payload = {"url": "https://example.com/remote.dcd", "name": "remote-test", "n_atoms": 1500, "n_frames": 50}
    r = client.post("/api/datasets/register", json=payload)
    assert r.status_code == 200
    entry = r.json()
    assert entry.get("id")
    bid = entry.get("id")
    b = client.get(f"/api/datasets/{bid}/benchmark")
    assert b.status_code == 200
    info = b.json()
    assert "n_atoms" in info
