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

# ParadeDB pg_search, pinned to 0.25.3, installed from the prebuilt PG16
# bookworm .deb released on the paradedb GitHub releases page. No Rust
# toolchain is needed — the package ships precompiled binaries. The arch is
# selected from the build platform (TARGETARCH) so the image builds on both
# amd64 and arm64 hosts.
#
# Verified BM25 query syntax for 0.25.x (renamed from the 0.15-0.17 API):
#   - index access method: `paradedb` (alias `bm25`), requires `key_field`
#   - match operator: `|||` (match disjunction) / `&&&` (match conjunction)
#   - scoring: `pdb.score(<key_field>)`
ARG PG_SEARCH_VERSION=0.25.3
ARG TARGETARCH
RUN apt-get update \
  && apt-get install -y --no-install-recommends curl ca-certificates \
  && curl -fsSL -o /tmp/pg-search.deb \
    "https://github.com/paradedb/paradedb/releases/download/v${PG_SEARCH_VERSION}/postgresql-16-pg-search_${PG_SEARCH_VERSION}-1PARADEDB-bookworm_${TARGETARCH}.deb" \
  && apt-get install -y --no-install-recommends /tmp/pg-search.deb \
  && rm -f /tmp/pg-search.deb \
  && rm -rf /var/lib/apt/lists/*

LABEL maintainer="aso-notes"
