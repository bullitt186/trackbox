FROM python:3.12-slim AS base
WORKDIR /app
COPY requirements.txt requirements-dev.txt requirements.lock ./
RUN pip install --no-cache-dir -r requirements.txt

FROM base AS test
RUN pip install --no-cache-dir -r requirements-dev.txt
COPY . .
RUN ruff check . && pytest tests/ -q --cov=ingest --cov-report=term-missing --cov-fail-under=25 && pip-audit --strict --progress-spinner off -r requirements.txt

FROM python:3.12-slim AS production
WORKDIR /app
COPY requirements.lock ./
RUN pip install --no-cache-dir -r requirements.lock
ARG VERSION=dev
ARG BUILD_TIME=unknown
ENV TRACKBOX_VERSION=${VERSION}
ENV TRACKBOX_BUILD_TIME=${BUILD_TIME}
LABEL org.opencontainers.image.source="https://git.stahmer.net/bullitt/trackbox" \
      org.opencontainers.image.title="Trackbox" \
      org.opencontainers.image.description="AI-powered parcel tracking" \
      org.opencontainers.image.version="${VERSION}"
COPY . .
EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
