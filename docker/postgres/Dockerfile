# PostgreSQL 16 with pgvector 0.8.0 and Apache AGE 1.5.0, built from pinned
# sources. The previous third-party image (marcosbolanos/pgvector-age) shipped
# a pgvector build that segfaulted on any vector index creation (HNSW/IVFFlat),
# so both extensions are now compiled against the matching server headers.
FROM postgres:16-bookworm AS builder

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    build-essential \
    ca-certificates \
    curl \
    postgresql-server-dev-16 \
    libreadline-dev \
    zlib1g-dev \
    flex \
    bison \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /build

RUN curl -fsSL https://github.com/pgvector/pgvector/archive/refs/tags/v0.8.0.tar.gz | tar xz \
  && cd pgvector-0.8.0 \
  && make \
  && make install

RUN curl -fsSL https://github.com/apache/age/archive/refs/tags/PG16/v1.5.0-rc0.tar.gz | tar xz \
  && cd age-PG16-v1.5.0-rc0 \
  && make \
  && make install

FROM postgres:16-bookworm

COPY --from=builder /usr/lib/postgresql/16/lib/ /usr/lib/postgresql/16/lib/
COPY --from=builder /usr/share/postgresql/16/extension/ /usr/share/postgresql/16/extension/

LABEL maintainer="aso-notes"
