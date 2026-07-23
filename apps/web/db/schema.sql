--
-- PostgreSQL database dump
--

-- Dumped from database version 15.14
-- Dumped by pg_dump version 15.10

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

ALTER TABLE IF EXISTS ONLY public.todos DROP CONSTRAINT IF EXISTS todos_user_id_fkey;
ALTER TABLE IF EXISTS ONLY public.sessions DROP CONSTRAINT IF EXISTS "sessions_userId_fkey";
ALTER TABLE IF EXISTS ONLY public.read_notifications DROP CONSTRAINT IF EXISTS read_notifications_user_id_fkey;
ALTER TABLE IF EXISTS ONLY public.read_notifications DROP CONSTRAINT IF EXISTS read_notifications_notification_id_fkey;
ALTER TABLE IF EXISTS ONLY public.notifications DROP CONSTRAINT IF EXISTS notifications_created_by_fkey;
ALTER TABLE IF EXISTS ONLY public.memberships DROP CONSTRAINT IF EXISTS memberships_workspace_id_fkey;
ALTER TABLE IF EXISTS ONLY public.memberships DROP CONSTRAINT IF EXISTS memberships_user_id_fkey;
ALTER TABLE IF EXISTS ONLY public.accounts DROP CONSTRAINT IF EXISTS "accounts_userId_fkey";
DROP INDEX IF EXISTS public.memberships_user_workspace_unique;
DROP INDEX IF EXISTS public.idx_todos_user_id;
DROP INDEX IF EXISTS public.idx_todos_created_at;
DROP INDEX IF EXISTS public.idx_todos_completed;
DROP INDEX IF EXISTS public.idx_read_notifications_user;
DROP INDEX IF EXISTS public.idx_read_notifications_unique;
DROP INDEX IF EXISTS public.idx_read_notifications_notification;
DROP INDEX IF EXISTS public.idx_notifications_target;
DROP INDEX IF EXISTS public.idx_notifications_created_at;
DROP INDEX IF EXISTS public.idx_notifications_active;
ALTER TABLE IF EXISTS ONLY public.workspaces DROP CONSTRAINT IF EXISTS workspaces_pkey;
ALTER TABLE IF EXISTS ONLY public.users DROP CONSTRAINT IF EXISTS users_pkey;
ALTER TABLE IF EXISTS ONLY public.users DROP CONSTRAINT IF EXISTS users_email_key;
ALTER TABLE IF EXISTS ONLY public.user_verifications DROP CONSTRAINT IF EXISTS user_verifications_pkey;
ALTER TABLE IF EXISTS ONLY public.todos DROP CONSTRAINT IF EXISTS todos_pkey;
ALTER TABLE IF EXISTS ONLY public.sessions DROP CONSTRAINT IF EXISTS sessions_token_key;
ALTER TABLE IF EXISTS ONLY public.sessions DROP CONSTRAINT IF EXISTS sessions_pkey;
ALTER TABLE IF EXISTS ONLY public.read_notifications DROP CONSTRAINT IF EXISTS read_notifications_pkey;
ALTER TABLE IF EXISTS ONLY public.notifications DROP CONSTRAINT IF EXISTS notifications_pkey;
ALTER TABLE IF EXISTS ONLY public.memberships DROP CONSTRAINT IF EXISTS memberships_pkey;
ALTER TABLE IF EXISTS ONLY public.kysely_migration DROP CONSTRAINT IF EXISTS kysely_migration_pkey;
ALTER TABLE IF EXISTS ONLY public.kysely_migration_lock DROP CONSTRAINT IF EXISTS kysely_migration_lock_pkey;
ALTER TABLE IF EXISTS ONLY public.accounts DROP CONSTRAINT IF EXISTS accounts_pkey;
ALTER TABLE IF EXISTS public.todos ALTER COLUMN id DROP DEFAULT;
ALTER TABLE IF EXISTS public.read_notifications ALTER COLUMN id DROP DEFAULT;
ALTER TABLE IF EXISTS public.notifications ALTER COLUMN id DROP DEFAULT;
DROP TABLE IF EXISTS public.workspaces;
DROP TABLE IF EXISTS public.users;
DROP TABLE IF EXISTS public.user_verifications;
DROP SEQUENCE IF EXISTS public.todos_id_seq;
DROP TABLE IF EXISTS public.todos;
DROP TABLE IF EXISTS public.sessions;
DROP SEQUENCE IF EXISTS public.read_notifications_id_seq;
DROP TABLE IF EXISTS public.read_notifications;
DROP SEQUENCE IF EXISTS public.notifications_id_seq;
DROP TABLE IF EXISTS public.notifications;
DROP TABLE IF EXISTS public.memberships;
DROP TABLE IF EXISTS public.kysely_migration_lock;
DROP TABLE IF EXISTS public.kysely_migration;
DROP TABLE IF EXISTS public.accounts;
SET default_table_access_method = heap;

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
    created_at timestamp without time zone DEFAULT '2026-07-23 10:56:33.651652'::timestamp without time zone NOT NULL,
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
    read_at timestamp without time zone DEFAULT '2026-07-23 10:56:33.651652'::timestamp without time zone NOT NULL
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
-- Name: workspaces; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workspaces (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


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
-- Name: accounts accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounts
    ADD CONSTRAINT accounts_pkey PRIMARY KEY (id);


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
-- Name: memberships memberships_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.memberships
    ADD CONSTRAINT memberships_pkey PRIMARY KEY (id);


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
-- Name: todos todos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.todos
    ADD CONSTRAINT todos_pkey PRIMARY KEY (id);


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
-- Name: workspaces workspaces_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspaces
    ADD CONSTRAINT workspaces_pkey PRIMARY KEY (id);


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
-- Name: memberships_user_workspace_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX memberships_user_workspace_unique ON public.memberships USING btree (user_id, workspace_id);


--
-- Name: accounts accounts_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounts
    ADD CONSTRAINT "accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES public.users(id);


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
-- Name: sessions sessions_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES public.users(id);


--
-- Name: todos todos_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.todos
    ADD CONSTRAINT todos_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

