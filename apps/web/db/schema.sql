--
-- PostgreSQL database dump
--

\restrict tYWduGEeqn8EaACEcoc0lQ7WkaGVTTLjjtSOkZ9icKSS5BTcmQS0OCzxZ2Tbe8S

-- Dumped from database version 16.14 (Debian 16.14-1.pgdg12+1)
-- Dumped by pg_dump version 16.14 (Debian 16.14-1.pgdg12+1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

ALTER TABLE IF EXISTS ONLY public.workspace_settings DROP CONSTRAINT IF EXISTS workspace_settings_workspace_id_fkey;
ALTER TABLE IF EXISTS ONLY public.topics DROP CONSTRAINT IF EXISTS topics_workspace_id_fkey;
ALTER TABLE IF EXISTS ONLY public.todos DROP CONSTRAINT IF EXISTS todos_user_id_fkey;
ALTER TABLE IF EXISTS ONLY public.tags DROP CONSTRAINT IF EXISTS tags_workspace_id_fkey;
ALTER TABLE IF EXISTS ONLY public.sources DROP CONSTRAINT IF EXISTS sources_workspace_id_fkey;
ALTER TABLE IF EXISTS ONLY public.sources DROP CONSTRAINT IF EXISTS sources_note_id_fkey;
ALTER TABLE IF EXISTS ONLY public.sessions DROP CONSTRAINT IF EXISTS "sessions_userId_fkey";
ALTER TABLE IF EXISTS ONLY public.relations DROP CONSTRAINT IF EXISTS relations_workspace_id_fkey;
ALTER TABLE IF EXISTS ONLY public.relations DROP CONSTRAINT IF EXISTS relations_to_concept_id_fkey;
ALTER TABLE IF EXISTS ONLY public.relations DROP CONSTRAINT IF EXISTS relations_from_concept_id_fkey;
ALTER TABLE IF EXISTS ONLY public.read_notifications DROP CONSTRAINT IF EXISTS read_notifications_user_id_fkey;
ALTER TABLE IF EXISTS ONLY public.read_notifications DROP CONSTRAINT IF EXISTS read_notifications_notification_id_fkey;
ALTER TABLE IF EXISTS ONLY public.notifications DROP CONSTRAINT IF EXISTS notifications_created_by_fkey;
ALTER TABLE IF EXISTS ONLY public.notes DROP CONSTRAINT IF EXISTS notes_workspace_id_fkey;
ALTER TABLE IF EXISTS ONLY public.notes DROP CONSTRAINT IF EXISTS notes_folder_id_fkey;
ALTER TABLE IF EXISTS ONLY public.note_tags DROP CONSTRAINT IF EXISTS note_tags_workspace_id_fkey;
ALTER TABLE IF EXISTS ONLY public.note_tags DROP CONSTRAINT IF EXISTS note_tags_tag_id_fkey;
ALTER TABLE IF EXISTS ONLY public.note_tags DROP CONSTRAINT IF EXISTS note_tags_note_id_fkey;
ALTER TABLE IF EXISTS ONLY public.note_tag_dismissals DROP CONSTRAINT IF EXISTS note_tag_dismissals_workspace_id_fkey;
ALTER TABLE IF EXISTS ONLY public.note_tag_dismissals DROP CONSTRAINT IF EXISTS note_tag_dismissals_tag_id_fkey;
ALTER TABLE IF EXISTS ONLY public.note_tag_dismissals DROP CONSTRAINT IF EXISTS note_tag_dismissals_note_id_fkey;
ALTER TABLE IF EXISTS ONLY public.messages DROP CONSTRAINT IF EXISTS messages_workspace_id_fkey;
ALTER TABLE IF EXISTS ONLY public.messages DROP CONSTRAINT IF EXISTS messages_conversation_id_fkey;
ALTER TABLE IF EXISTS ONLY public.mentions DROP CONSTRAINT IF EXISTS mentions_workspace_id_fkey;
ALTER TABLE IF EXISTS ONLY public.mentions DROP CONSTRAINT IF EXISTS mentions_concept_id_fkey;
ALTER TABLE IF EXISTS ONLY public.mentions DROP CONSTRAINT IF EXISTS mentions_chunk_id_fkey;
ALTER TABLE IF EXISTS ONLY public.memberships DROP CONSTRAINT IF EXISTS memberships_workspace_id_fkey;
ALTER TABLE IF EXISTS ONLY public.memberships DROP CONSTRAINT IF EXISTS memberships_user_id_fkey;
ALTER TABLE IF EXISTS ONLY public.links DROP CONSTRAINT IF EXISTS links_workspace_id_fkey;
ALTER TABLE IF EXISTS ONLY public.links DROP CONSTRAINT IF EXISTS links_to_note_id_fkey;
ALTER TABLE IF EXISTS ONLY public.links DROP CONSTRAINT IF EXISTS links_from_note_id_fkey;
ALTER TABLE IF EXISTS ONLY public.folders DROP CONSTRAINT IF EXISTS folders_workspace_id_fkey;
ALTER TABLE IF EXISTS ONLY public.conversations DROP CONSTRAINT IF EXISTS conversations_workspace_id_fkey;
ALTER TABLE IF EXISTS ONLY public.concepts DROP CONSTRAINT IF EXISTS concepts_workspace_id_fkey;
ALTER TABLE IF EXISTS ONLY public.concept_topics DROP CONSTRAINT IF EXISTS concept_topics_workspace_id_fkey;
ALTER TABLE IF EXISTS ONLY public.concept_topics DROP CONSTRAINT IF EXISTS concept_topics_topic_id_fkey;
ALTER TABLE IF EXISTS ONLY public.concept_topics DROP CONSTRAINT IF EXISTS concept_topics_concept_id_fkey;
ALTER TABLE IF EXISTS ONLY public.chunks DROP CONSTRAINT IF EXISTS chunks_workspace_id_fkey;
ALTER TABLE IF EXISTS ONLY public.chunks DROP CONSTRAINT IF EXISTS chunks_note_id_fkey;
ALTER TABLE IF EXISTS ONLY public.accounts DROP CONSTRAINT IF EXISTS "accounts_userId_fkey";
DROP INDEX IF EXISTS public.topics_workspace_name_normalized_unique;
DROP INDEX IF EXISTS public.tags_workspace_name_normalized_unique;
DROP INDEX IF EXISTS public.sources_note_url_normalized_unique;
DROP INDEX IF EXISTS public.notes_workspace_path_unique;
DROP INDEX IF EXISTS public.mentions_chunk_concept_unique;
DROP INDEX IF EXISTS public.memberships_user_workspace_unique;
DROP INDEX IF EXISTS public.idx_topics_embedding_hnsw;
DROP INDEX IF EXISTS public.idx_todos_user_id;
DROP INDEX IF EXISTS public.idx_todos_created_at;
DROP INDEX IF EXISTS public.idx_todos_completed;
DROP INDEX IF EXISTS public.idx_read_notifications_user;
DROP INDEX IF EXISTS public.idx_read_notifications_unique;
DROP INDEX IF EXISTS public.idx_read_notifications_notification;
DROP INDEX IF EXISTS public.idx_notifications_target;
DROP INDEX IF EXISTS public.idx_notifications_created_at;
DROP INDEX IF EXISTS public.idx_notifications_active;
DROP INDEX IF EXISTS public.idx_notes_status_updated_at;
DROP INDEX IF EXISTS public.idx_messages_conversation_id;
DROP INDEX IF EXISTS public.idx_mentions_concept_id;
DROP INDEX IF EXISTS public.idx_links_to_note_id;
DROP INDEX IF EXISTS public.idx_links_from_note_id;
DROP INDEX IF EXISTS public.idx_concepts_embedding_hnsw;
DROP INDEX IF EXISTS public.idx_chunks_note_id;
DROP INDEX IF EXISTS public.idx_chunks_embedding_hnsw;
DROP INDEX IF EXISTS public.folders_workspace_path_unique;
DROP INDEX IF EXISTS public.concepts_workspace_name_normalized_unique;
ALTER TABLE IF EXISTS ONLY public.workspaces DROP CONSTRAINT IF EXISTS workspaces_pkey;
ALTER TABLE IF EXISTS ONLY public.workspace_settings DROP CONSTRAINT IF EXISTS workspace_settings_pkey;
ALTER TABLE IF EXISTS ONLY public.users DROP CONSTRAINT IF EXISTS users_pkey;
ALTER TABLE IF EXISTS ONLY public.users DROP CONSTRAINT IF EXISTS users_email_key;
ALTER TABLE IF EXISTS ONLY public.user_verifications DROP CONSTRAINT IF EXISTS user_verifications_pkey;
ALTER TABLE IF EXISTS ONLY public.topics DROP CONSTRAINT IF EXISTS topics_pkey;
ALTER TABLE IF EXISTS ONLY public.todos DROP CONSTRAINT IF EXISTS todos_pkey;
ALTER TABLE IF EXISTS ONLY public.tags DROP CONSTRAINT IF EXISTS tags_pkey;
ALTER TABLE IF EXISTS ONLY public.sources DROP CONSTRAINT IF EXISTS sources_pkey;
ALTER TABLE IF EXISTS ONLY public.sessions DROP CONSTRAINT IF EXISTS sessions_token_key;
ALTER TABLE IF EXISTS ONLY public.sessions DROP CONSTRAINT IF EXISTS sessions_pkey;
ALTER TABLE IF EXISTS ONLY public.relations DROP CONSTRAINT IF EXISTS relations_pkey;
ALTER TABLE IF EXISTS ONLY public.read_notifications DROP CONSTRAINT IF EXISTS read_notifications_pkey;
ALTER TABLE IF EXISTS ONLY public.notifications DROP CONSTRAINT IF EXISTS notifications_pkey;
ALTER TABLE IF EXISTS ONLY public.notes DROP CONSTRAINT IF EXISTS notes_pkey;
ALTER TABLE IF EXISTS ONLY public.note_tags DROP CONSTRAINT IF EXISTS note_tags_pkey;
ALTER TABLE IF EXISTS ONLY public.note_tag_dismissals DROP CONSTRAINT IF EXISTS note_tag_dismissals_pkey;
ALTER TABLE IF EXISTS ONLY public.messages DROP CONSTRAINT IF EXISTS messages_pkey;
ALTER TABLE IF EXISTS ONLY public.mentions DROP CONSTRAINT IF EXISTS mentions_pkey;
ALTER TABLE IF EXISTS ONLY public.memberships DROP CONSTRAINT IF EXISTS memberships_pkey;
ALTER TABLE IF EXISTS ONLY public.links DROP CONSTRAINT IF EXISTS links_pkey;
ALTER TABLE IF EXISTS ONLY public.kysely_migration DROP CONSTRAINT IF EXISTS kysely_migration_pkey;
ALTER TABLE IF EXISTS ONLY public.kysely_migration_lock DROP CONSTRAINT IF EXISTS kysely_migration_lock_pkey;
ALTER TABLE IF EXISTS ONLY public.folders DROP CONSTRAINT IF EXISTS folders_pkey;
ALTER TABLE IF EXISTS ONLY public.conversations DROP CONSTRAINT IF EXISTS conversations_pkey;
ALTER TABLE IF EXISTS ONLY public.concepts DROP CONSTRAINT IF EXISTS concepts_pkey;
ALTER TABLE IF EXISTS ONLY public.concept_topics DROP CONSTRAINT IF EXISTS concept_topics_pkey;
ALTER TABLE IF EXISTS ONLY public.chunks DROP CONSTRAINT IF EXISTS chunks_pkey;
ALTER TABLE IF EXISTS ONLY public.accounts DROP CONSTRAINT IF EXISTS accounts_pkey;
ALTER TABLE IF EXISTS ONLY notes_graph._ag_label_vertex DROP CONSTRAINT IF EXISTS _ag_label_vertex_pkey;
ALTER TABLE IF EXISTS ONLY notes_graph._ag_label_edge DROP CONSTRAINT IF EXISTS _ag_label_edge_pkey;
ALTER TABLE IF EXISTS public.todos ALTER COLUMN id DROP DEFAULT;
ALTER TABLE IF EXISTS public.read_notifications ALTER COLUMN id DROP DEFAULT;
ALTER TABLE IF EXISTS public.notifications ALTER COLUMN id DROP DEFAULT;
ALTER TABLE IF EXISTS notes_graph._ag_label_vertex ALTER COLUMN id DROP DEFAULT;
ALTER TABLE IF EXISTS notes_graph._ag_label_edge ALTER COLUMN id DROP DEFAULT;
DROP TABLE IF EXISTS public.workspaces;
DROP TABLE IF EXISTS public.workspace_settings;
DROP TABLE IF EXISTS public.users;
DROP TABLE IF EXISTS public.user_verifications;
DROP TABLE IF EXISTS public.topics;
DROP SEQUENCE IF EXISTS public.todos_id_seq;
DROP TABLE IF EXISTS public.todos;
DROP TABLE IF EXISTS public.tags;
DROP TABLE IF EXISTS public.sources;
DROP TABLE IF EXISTS public.sessions;
DROP TABLE IF EXISTS public.relations;
DROP SEQUENCE IF EXISTS public.read_notifications_id_seq;
DROP TABLE IF EXISTS public.read_notifications;
DROP SEQUENCE IF EXISTS public.notifications_id_seq;
DROP TABLE IF EXISTS public.notifications;
DROP TABLE IF EXISTS public.notes;
DROP TABLE IF EXISTS public.note_tags;
DROP TABLE IF EXISTS public.note_tag_dismissals;
DROP TABLE IF EXISTS public.messages;
DROP TABLE IF EXISTS public.mentions;
DROP TABLE IF EXISTS public.memberships;
DROP TABLE IF EXISTS public.links;
DROP TABLE IF EXISTS public.kysely_migration_lock;
DROP TABLE IF EXISTS public.kysely_migration;
DROP TABLE IF EXISTS public.folders;
DROP TABLE IF EXISTS public.conversations;
DROP TABLE IF EXISTS public.concepts;
DROP TABLE IF EXISTS public.concept_topics;
DROP TABLE IF EXISTS public.chunks;
DROP TABLE IF EXISTS public.accounts;
DROP SEQUENCE IF EXISTS notes_graph._label_id_seq;
DROP SEQUENCE IF EXISTS notes_graph._ag_label_vertex_id_seq;
DROP TABLE IF EXISTS notes_graph._ag_label_vertex;
DROP SEQUENCE IF EXISTS notes_graph._ag_label_edge_id_seq;
DROP TABLE IF EXISTS notes_graph._ag_label_edge;
DROP EXTENSION IF EXISTS vector;
DROP EXTENSION IF EXISTS age;
DROP SCHEMA IF EXISTS notes_graph;
DROP SCHEMA IF EXISTS ag_catalog;
--
-- Name: ag_catalog; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA ag_catalog;


--
-- Name: notes_graph; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA notes_graph;


--
-- Name: age; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS age WITH SCHEMA ag_catalog;


--
-- Name: EXTENSION age; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION age IS 'AGE database extension';


--
-- Name: vector; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;


--
-- Name: EXTENSION vector; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION vector IS 'vector data type and ivfflat and hnsw access methods';


SET default_table_access_method = heap;

--
-- Name: _ag_label_edge; Type: TABLE; Schema: notes_graph; Owner: -
--

CREATE TABLE notes_graph._ag_label_edge (
    id ag_catalog.graphid NOT NULL,
    start_id ag_catalog.graphid NOT NULL,
    end_id ag_catalog.graphid NOT NULL,
    properties ag_catalog.agtype DEFAULT ag_catalog.agtype_build_map() NOT NULL
);


--
-- Name: _ag_label_edge_id_seq; Type: SEQUENCE; Schema: notes_graph; Owner: -
--

CREATE SEQUENCE notes_graph._ag_label_edge_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    MAXVALUE 281474976710655
    CACHE 1;


--
-- Name: _ag_label_edge_id_seq; Type: SEQUENCE OWNED BY; Schema: notes_graph; Owner: -
--

ALTER SEQUENCE notes_graph._ag_label_edge_id_seq OWNED BY notes_graph._ag_label_edge.id;


--
-- Name: _ag_label_vertex; Type: TABLE; Schema: notes_graph; Owner: -
--

CREATE TABLE notes_graph._ag_label_vertex (
    id ag_catalog.graphid NOT NULL,
    properties ag_catalog.agtype DEFAULT ag_catalog.agtype_build_map() NOT NULL
);


--
-- Name: _ag_label_vertex_id_seq; Type: SEQUENCE; Schema: notes_graph; Owner: -
--

CREATE SEQUENCE notes_graph._ag_label_vertex_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    MAXVALUE 281474976710655
    CACHE 1;


--
-- Name: _ag_label_vertex_id_seq; Type: SEQUENCE OWNED BY; Schema: notes_graph; Owner: -
--

ALTER SEQUENCE notes_graph._ag_label_vertex_id_seq OWNED BY notes_graph._ag_label_vertex.id;


--
-- Name: _label_id_seq; Type: SEQUENCE; Schema: notes_graph; Owner: -
--

CREATE SEQUENCE notes_graph._label_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    MAXVALUE 65535
    CACHE 1
    CYCLE;


--
-- Name: accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.accounts (
    id text NOT NULL,
    "accountId" text NOT NULL,
    "providerId" text NOT NULL,
    "userId" text NOT NULL,
    "accessToken" text,
    "refreshToken" text,
    "idToken" text,
    "accessTokenExpiresAt" timestamp without time zone,
    "refreshTokenExpiresAt" timestamp without time zone,
    scope text,
    password text,
    "createdAt" timestamp without time zone NOT NULL,
    "updatedAt" timestamp without time zone NOT NULL
);


--
-- Name: chunks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chunks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    note_id uuid NOT NULL,
    seq integer NOT NULL,
    text text NOT NULL,
    token_count integer,
    embedding public.halfvec(2048),
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: concept_topics; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.concept_topics (
    workspace_id uuid NOT NULL,
    concept_id uuid NOT NULL,
    topic_id uuid NOT NULL
);


--
-- Name: concepts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.concepts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    name character varying NOT NULL,
    name_normalized character varying NOT NULL,
    description text,
    embedding public.halfvec(2048),
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: conversations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.conversations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    title character varying,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    archived_at timestamp without time zone
);


--
-- Name: folders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.folders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    path character varying NOT NULL,
    cover_content text,
    cover_hash character varying,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: kysely_migration; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.kysely_migration (
    name character varying(255) NOT NULL,
    "timestamp" character varying(255) NOT NULL
);


--
-- Name: kysely_migration_lock; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.kysely_migration_lock (
    id character varying(255) NOT NULL,
    is_locked integer DEFAULT 0 NOT NULL
);


--
-- Name: links; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.links (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    from_note_id uuid NOT NULL,
    to_note_id uuid,
    raw_target character varying NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: memberships; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.memberships (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id character varying NOT NULL,
    workspace_id uuid NOT NULL,
    role character varying DEFAULT 'member'::character varying NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    deactivated_at timestamp without time zone
);


--
-- Name: mentions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mentions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    chunk_id uuid NOT NULL,
    concept_id uuid NOT NULL
);


--
-- Name: messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    conversation_id uuid NOT NULL,
    role character varying NOT NULL,
    content text,
    tool_calls jsonb,
    tool_call_id character varying,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    CONSTRAINT messages_role_check CHECK (((role)::text = ANY ((ARRAY['user'::character varying, 'assistant'::character varying, 'tool'::character varying])::text[])))
);


--
-- Name: note_tag_dismissals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.note_tag_dismissals (
    workspace_id uuid NOT NULL,
    note_id uuid NOT NULL,
    tag_id uuid NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: note_tags; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.note_tags (
    workspace_id uuid NOT NULL,
    note_id uuid NOT NULL,
    tag_id uuid NOT NULL,
    origin character varying NOT NULL,
    CONSTRAINT note_tags_origin_check CHECK (((origin)::text = ANY ((ARRAY['user'::character varying, 'ai'::character varying])::text[])))
);


--
-- Name: notes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    folder_id uuid,
    path character varying NOT NULL,
    title character varying NOT NULL,
    content text,
    content_hash character varying,
    ingested_hash character varying,
    status character varying DEFAULT 'pending'::character varying NOT NULL,
    pipeline character varying DEFAULT 'markdown-note'::character varying NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    CONSTRAINT notes_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'ingested'::character varying, 'failed'::character varying])::text[])))
);


--
-- Name: notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notifications (
    id integer NOT NULL,
    title character varying(255) NOT NULL,
    message text NOT NULL,
    type character varying(50) DEFAULT 'info'::character varying NOT NULL,
    target_type character varying(50) NOT NULL,
    target_id text,
    created_by text NOT NULL,
    created_at timestamp without time zone DEFAULT '2026-07-28 02:12:54.992439'::timestamp without time zone NOT NULL,
    is_active boolean DEFAULT true NOT NULL
);


--
-- Name: notifications_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.notifications_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: notifications_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.notifications_id_seq OWNED BY public.notifications.id;


--
-- Name: read_notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.read_notifications (
    id integer NOT NULL,
    notification_id integer NOT NULL,
    user_id text NOT NULL,
    read_at timestamp without time zone DEFAULT '2026-07-28 02:12:54.992439'::timestamp without time zone NOT NULL
);


--
-- Name: read_notifications_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.read_notifications_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: read_notifications_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.read_notifications_id_seq OWNED BY public.read_notifications.id;


--
-- Name: relations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.relations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    from_concept_id uuid NOT NULL,
    to_concept_id uuid NOT NULL,
    type character varying NOT NULL,
    description text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sessions (
    id text NOT NULL,
    "expiresAt" timestamp without time zone NOT NULL,
    token text NOT NULL,
    "createdAt" timestamp without time zone NOT NULL,
    "updatedAt" timestamp without time zone NOT NULL,
    "ipAddress" text,
    "userAgent" text,
    "userId" text NOT NULL
);


--
-- Name: sources; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sources (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    note_id uuid NOT NULL,
    url text NOT NULL,
    url_normalized text NOT NULL,
    title character varying,
    type character varying,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: tags; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tags (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    name character varying NOT NULL,
    name_normalized character varying NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: todos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.todos (
    id integer NOT NULL,
    user_id text NOT NULL,
    title character varying(255) NOT NULL,
    description text,
    completed boolean DEFAULT false NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: todos_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.todos_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: todos_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.todos_id_seq OWNED BY public.todos.id;


--
-- Name: topics; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.topics (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    name character varying NOT NULL,
    name_normalized character varying NOT NULL,
    description text,
    embedding public.halfvec(2048),
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: user_verifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_verifications (
    id text NOT NULL,
    identifier text NOT NULL,
    value text NOT NULL,
    "expiresAt" timestamp without time zone NOT NULL,
    "createdAt" timestamp without time zone,
    "updatedAt" timestamp without time zone
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id text NOT NULL,
    name text NOT NULL,
    email text NOT NULL,
    "emailVerified" boolean NOT NULL,
    image text,
    "createdAt" timestamp without time zone NOT NULL,
    "updatedAt" timestamp without time zone NOT NULL
);


--
-- Name: workspace_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workspace_settings (
    workspace_id uuid NOT NULL,
    key character varying NOT NULL,
    value jsonb NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: workspaces; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workspaces (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: _ag_label_edge id; Type: DEFAULT; Schema: notes_graph; Owner: -
--

ALTER TABLE ONLY notes_graph._ag_label_edge ALTER COLUMN id SET DEFAULT ag_catalog._graphid((ag_catalog._label_id('notes_graph'::name, '_ag_label_edge'::name))::integer, nextval('notes_graph._ag_label_edge_id_seq'::regclass));


--
-- Name: _ag_label_vertex id; Type: DEFAULT; Schema: notes_graph; Owner: -
--

ALTER TABLE ONLY notes_graph._ag_label_vertex ALTER COLUMN id SET DEFAULT ag_catalog._graphid((ag_catalog._label_id('notes_graph'::name, '_ag_label_vertex'::name))::integer, nextval('notes_graph._ag_label_vertex_id_seq'::regclass));


--
-- Name: notifications id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications ALTER COLUMN id SET DEFAULT nextval('public.notifications_id_seq'::regclass);


--
-- Name: read_notifications id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.read_notifications ALTER COLUMN id SET DEFAULT nextval('public.read_notifications_id_seq'::regclass);


--
-- Name: todos id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.todos ALTER COLUMN id SET DEFAULT nextval('public.todos_id_seq'::regclass);


--
-- Name: _ag_label_edge _ag_label_edge_pkey; Type: CONSTRAINT; Schema: notes_graph; Owner: -
--

ALTER TABLE ONLY notes_graph._ag_label_edge
    ADD CONSTRAINT _ag_label_edge_pkey PRIMARY KEY (id);


--
-- Name: _ag_label_vertex _ag_label_vertex_pkey; Type: CONSTRAINT; Schema: notes_graph; Owner: -
--

ALTER TABLE ONLY notes_graph._ag_label_vertex
    ADD CONSTRAINT _ag_label_vertex_pkey PRIMARY KEY (id);


--
-- Name: accounts accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounts
    ADD CONSTRAINT accounts_pkey PRIMARY KEY (id);


--
-- Name: chunks chunks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chunks
    ADD CONSTRAINT chunks_pkey PRIMARY KEY (id);


--
-- Name: concept_topics concept_topics_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.concept_topics
    ADD CONSTRAINT concept_topics_pkey PRIMARY KEY (concept_id, topic_id);


--
-- Name: concepts concepts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.concepts
    ADD CONSTRAINT concepts_pkey PRIMARY KEY (id);


--
-- Name: conversations conversations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversations
    ADD CONSTRAINT conversations_pkey PRIMARY KEY (id);


--
-- Name: folders folders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.folders
    ADD CONSTRAINT folders_pkey PRIMARY KEY (id);


--
-- Name: kysely_migration_lock kysely_migration_lock_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kysely_migration_lock
    ADD CONSTRAINT kysely_migration_lock_pkey PRIMARY KEY (id);


--
-- Name: kysely_migration kysely_migration_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kysely_migration
    ADD CONSTRAINT kysely_migration_pkey PRIMARY KEY (name);


--
-- Name: links links_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.links
    ADD CONSTRAINT links_pkey PRIMARY KEY (id);


--
-- Name: memberships memberships_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.memberships
    ADD CONSTRAINT memberships_pkey PRIMARY KEY (id);


--
-- Name: mentions mentions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mentions
    ADD CONSTRAINT mentions_pkey PRIMARY KEY (id);


--
-- Name: messages messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_pkey PRIMARY KEY (id);


--
-- Name: note_tag_dismissals note_tag_dismissals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.note_tag_dismissals
    ADD CONSTRAINT note_tag_dismissals_pkey PRIMARY KEY (note_id, tag_id);


--
-- Name: note_tags note_tags_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.note_tags
    ADD CONSTRAINT note_tags_pkey PRIMARY KEY (note_id, tag_id);


--
-- Name: notes notes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notes
    ADD CONSTRAINT notes_pkey PRIMARY KEY (id);


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);


--
-- Name: read_notifications read_notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.read_notifications
    ADD CONSTRAINT read_notifications_pkey PRIMARY KEY (id);


--
-- Name: relations relations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.relations
    ADD CONSTRAINT relations_pkey PRIMARY KEY (id);


--
-- Name: sessions sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_pkey PRIMARY KEY (id);


--
-- Name: sessions sessions_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_token_key UNIQUE (token);


--
-- Name: sources sources_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sources
    ADD CONSTRAINT sources_pkey PRIMARY KEY (id);


--
-- Name: tags tags_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tags
    ADD CONSTRAINT tags_pkey PRIMARY KEY (id);


--
-- Name: todos todos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.todos
    ADD CONSTRAINT todos_pkey PRIMARY KEY (id);


--
-- Name: topics topics_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.topics
    ADD CONSTRAINT topics_pkey PRIMARY KEY (id);


--
-- Name: user_verifications user_verifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_verifications
    ADD CONSTRAINT user_verifications_pkey PRIMARY KEY (id);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: workspace_settings workspace_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_settings
    ADD CONSTRAINT workspace_settings_pkey PRIMARY KEY (workspace_id, key);


--
-- Name: workspaces workspaces_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspaces
    ADD CONSTRAINT workspaces_pkey PRIMARY KEY (id);


--
-- Name: concepts_workspace_name_normalized_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX concepts_workspace_name_normalized_unique ON public.concepts USING btree (workspace_id, name_normalized);


--
-- Name: folders_workspace_path_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX folders_workspace_path_unique ON public.folders USING btree (workspace_id, path);


--
-- Name: idx_chunks_embedding_hnsw; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chunks_embedding_hnsw ON public.chunks USING hnsw (embedding public.halfvec_cosine_ops);


--
-- Name: idx_chunks_note_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chunks_note_id ON public.chunks USING btree (note_id);


--
-- Name: idx_concepts_embedding_hnsw; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_concepts_embedding_hnsw ON public.concepts USING hnsw (embedding public.halfvec_cosine_ops);


--
-- Name: idx_links_from_note_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_links_from_note_id ON public.links USING btree (from_note_id);


--
-- Name: idx_links_to_note_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_links_to_note_id ON public.links USING btree (to_note_id);


--
-- Name: idx_mentions_concept_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mentions_concept_id ON public.mentions USING btree (concept_id);


--
-- Name: idx_messages_conversation_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_messages_conversation_id ON public.messages USING btree (conversation_id);


--
-- Name: idx_notes_status_updated_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notes_status_updated_at ON public.notes USING btree (status, updated_at);


--
-- Name: idx_notifications_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_active ON public.notifications USING btree (is_active);


--
-- Name: idx_notifications_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_created_at ON public.notifications USING btree (created_at);


--
-- Name: idx_notifications_target; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_target ON public.notifications USING btree (target_type, target_id);


--
-- Name: idx_read_notifications_notification; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_read_notifications_notification ON public.read_notifications USING btree (notification_id);


--
-- Name: idx_read_notifications_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_read_notifications_unique ON public.read_notifications USING btree (notification_id, user_id);


--
-- Name: idx_read_notifications_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_read_notifications_user ON public.read_notifications USING btree (user_id);


--
-- Name: idx_todos_completed; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_todos_completed ON public.todos USING btree (completed);


--
-- Name: idx_todos_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_todos_created_at ON public.todos USING btree (created_at);


--
-- Name: idx_todos_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_todos_user_id ON public.todos USING btree (user_id);


--
-- Name: idx_topics_embedding_hnsw; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_topics_embedding_hnsw ON public.topics USING hnsw (embedding public.halfvec_cosine_ops);


--
-- Name: memberships_user_workspace_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX memberships_user_workspace_unique ON public.memberships USING btree (user_id, workspace_id);


--
-- Name: mentions_chunk_concept_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX mentions_chunk_concept_unique ON public.mentions USING btree (chunk_id, concept_id);


--
-- Name: notes_workspace_path_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX notes_workspace_path_unique ON public.notes USING btree (workspace_id, path);


--
-- Name: sources_note_url_normalized_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX sources_note_url_normalized_unique ON public.sources USING btree (note_id, url_normalized);


--
-- Name: tags_workspace_name_normalized_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX tags_workspace_name_normalized_unique ON public.tags USING btree (workspace_id, name_normalized);


--
-- Name: topics_workspace_name_normalized_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX topics_workspace_name_normalized_unique ON public.topics USING btree (workspace_id, name_normalized);


--
-- Name: accounts accounts_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounts
    ADD CONSTRAINT "accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES public.users(id);


--
-- Name: chunks chunks_note_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chunks
    ADD CONSTRAINT chunks_note_id_fkey FOREIGN KEY (note_id) REFERENCES public.notes(id) ON DELETE CASCADE;


--
-- Name: chunks chunks_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chunks
    ADD CONSTRAINT chunks_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: concept_topics concept_topics_concept_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.concept_topics
    ADD CONSTRAINT concept_topics_concept_id_fkey FOREIGN KEY (concept_id) REFERENCES public.concepts(id) ON DELETE CASCADE;


--
-- Name: concept_topics concept_topics_topic_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.concept_topics
    ADD CONSTRAINT concept_topics_topic_id_fkey FOREIGN KEY (topic_id) REFERENCES public.topics(id) ON DELETE CASCADE;


--
-- Name: concept_topics concept_topics_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.concept_topics
    ADD CONSTRAINT concept_topics_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: concepts concepts_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.concepts
    ADD CONSTRAINT concepts_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: conversations conversations_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversations
    ADD CONSTRAINT conversations_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: folders folders_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.folders
    ADD CONSTRAINT folders_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: links links_from_note_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.links
    ADD CONSTRAINT links_from_note_id_fkey FOREIGN KEY (from_note_id) REFERENCES public.notes(id) ON DELETE CASCADE;


--
-- Name: links links_to_note_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.links
    ADD CONSTRAINT links_to_note_id_fkey FOREIGN KEY (to_note_id) REFERENCES public.notes(id) ON DELETE CASCADE;


--
-- Name: links links_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.links
    ADD CONSTRAINT links_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: memberships memberships_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.memberships
    ADD CONSTRAINT memberships_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: memberships memberships_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.memberships
    ADD CONSTRAINT memberships_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: mentions mentions_chunk_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mentions
    ADD CONSTRAINT mentions_chunk_id_fkey FOREIGN KEY (chunk_id) REFERENCES public.chunks(id) ON DELETE CASCADE;


--
-- Name: mentions mentions_concept_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mentions
    ADD CONSTRAINT mentions_concept_id_fkey FOREIGN KEY (concept_id) REFERENCES public.concepts(id) ON DELETE CASCADE;


--
-- Name: mentions mentions_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mentions
    ADD CONSTRAINT mentions_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: messages messages_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE;


--
-- Name: messages messages_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: note_tag_dismissals note_tag_dismissals_note_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.note_tag_dismissals
    ADD CONSTRAINT note_tag_dismissals_note_id_fkey FOREIGN KEY (note_id) REFERENCES public.notes(id) ON DELETE CASCADE;


--
-- Name: note_tag_dismissals note_tag_dismissals_tag_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.note_tag_dismissals
    ADD CONSTRAINT note_tag_dismissals_tag_id_fkey FOREIGN KEY (tag_id) REFERENCES public.tags(id) ON DELETE CASCADE;


--
-- Name: note_tag_dismissals note_tag_dismissals_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.note_tag_dismissals
    ADD CONSTRAINT note_tag_dismissals_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: note_tags note_tags_note_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.note_tags
    ADD CONSTRAINT note_tags_note_id_fkey FOREIGN KEY (note_id) REFERENCES public.notes(id) ON DELETE CASCADE;


--
-- Name: note_tags note_tags_tag_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.note_tags
    ADD CONSTRAINT note_tags_tag_id_fkey FOREIGN KEY (tag_id) REFERENCES public.tags(id) ON DELETE CASCADE;


--
-- Name: note_tags note_tags_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.note_tags
    ADD CONSTRAINT note_tags_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: notes notes_folder_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notes
    ADD CONSTRAINT notes_folder_id_fkey FOREIGN KEY (folder_id) REFERENCES public.folders(id) ON DELETE SET NULL;


--
-- Name: notes notes_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notes
    ADD CONSTRAINT notes_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: notifications notifications_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: read_notifications read_notifications_notification_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.read_notifications
    ADD CONSTRAINT read_notifications_notification_id_fkey FOREIGN KEY (notification_id) REFERENCES public.notifications(id) ON DELETE CASCADE;


--
-- Name: read_notifications read_notifications_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.read_notifications
    ADD CONSTRAINT read_notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: relations relations_from_concept_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.relations
    ADD CONSTRAINT relations_from_concept_id_fkey FOREIGN KEY (from_concept_id) REFERENCES public.concepts(id) ON DELETE CASCADE;


--
-- Name: relations relations_to_concept_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.relations
    ADD CONSTRAINT relations_to_concept_id_fkey FOREIGN KEY (to_concept_id) REFERENCES public.concepts(id) ON DELETE CASCADE;


--
-- Name: relations relations_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.relations
    ADD CONSTRAINT relations_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: sessions sessions_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES public.users(id);


--
-- Name: sources sources_note_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sources
    ADD CONSTRAINT sources_note_id_fkey FOREIGN KEY (note_id) REFERENCES public.notes(id) ON DELETE CASCADE;


--
-- Name: sources sources_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sources
    ADD CONSTRAINT sources_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: tags tags_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tags
    ADD CONSTRAINT tags_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: todos todos_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.todos
    ADD CONSTRAINT todos_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: topics topics_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.topics
    ADD CONSTRAINT topics_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: workspace_settings workspace_settings_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_settings
    ADD CONSTRAINT workspace_settings_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict tYWduGEeqn8EaACEcoc0lQ7WkaGVTTLjjtSOkZ9icKSS5BTcmQS0OCzxZ2Tbe8S

