FROM python:3.12-slim AS base
WORKDIR /app
COPY requirements.txt requirements-dev.txt requirements.lock ./
RUN pip install --no-cache-dir -r requirements.txt

FROM base AS test
RUN pip install --no-cache-dir -r requirements-dev.txt
COPY . .
RUN ruff check . \
 && mypy config.py main.py db.py ingest.py --no-error-summary || true \
 && pytest tests/ -q --cov=. --cov-report=term-missing --cov-fail-under=18 \
 && pip-audit --strict --progress-spinner off -r requirements.txt

FROM node:20-slim AS frontend-build
WORKDIR /frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ .
RUN npm run build

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
COPY --from=frontend-build /frontend/dist ./frontend/dist
# Drop root privileges: create a dedicated non-root user and fix ownership
RUN useradd -r -u 1001 -m -d /app -s /sbin/nologin app \
    && mkdir -p /app/data \
    && chown -R app:app /app
USER app
EXPOSE 8000
# Native health signal so Docker/Komodo can restart unhealthy containers automatically.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
