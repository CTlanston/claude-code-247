"""Marker test — guarantees pytest discovers something even if other
test modules fail to import (e.g. missing pytest-cov)."""

def test_autodev_imports():
    import autodev
    assert autodev.__version__ == "3.0.0"
