FROM python:3.12-slim AS base
WORKDIR /app
COPY requirements.txt requirements-dev.txt ./
RUN pip install --no-cache-dir -r requirements.txt

FROM base AS test
RUN pip install --no-cache-dir -r requirements-dev.txt
COPY . .
RUN ruff check . && pytest tests/ -q --cov=ingest --cov-report=term-missing --cov-fail-under=25 && pip-audit --strict --progress-spinner off -r requirements.txt

FROM base AS production
ARG VERSION=dev
ENV TRACKBOX_VERSION=${VERSION}
COPY . .
EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
