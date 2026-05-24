# claude-code-247 — local dev convenience.
#
# `make install` builds a venv and editable-installs the package + dev deps.
# `make test`    runs pytest.
# `make doctor`  shells `claude247 doctor` against a tmp state dir.
# `make dash`    starts the dashboard in dev mode.

PY      ?= python3.13
VENV    ?= .venv
PIP     ?= $(VENV)/bin/pip
PYBIN   ?= $(VENV)/bin/python
CLAUDE247 ?= $(VENV)/bin/claude247

.PHONY: help
help:
	@echo "make install         create venv + install package (editable, with dev+test extras)"
	@echo "make test            run unit + integration tests"
	@echo "make doctor          run claude247 doctor"
	@echo "make dash            run dashboard at http://127.0.0.1:8423"
	@echo "make clean           remove venv + caches"

$(VENV)/bin/python:
	$(PY) -m venv $(VENV)

.PHONY: install
install: $(VENV)/bin/python
	$(PIP) install --upgrade pip
	$(PIP) install -e ".[test,dev]"

.PHONY: test
test:
	$(VENV)/bin/pytest

.PHONY: doctor
doctor:
	$(CLAUDE247) doctor

.PHONY: dash
dash:
	$(VENV)/bin/uvicorn dashboard.app:app --reload --host 127.0.0.1 --port 8423

.PHONY: clean
clean:
	rm -rf $(VENV) .pytest_cache .coverage htmlcov build dist *.egg-info
	find . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true
