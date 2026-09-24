import {
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  ArrowRight,
  Plus,
  Search,
  LayoutGrid,
  Archive,
  CalendarDays,
  Clock3,
  MoreHorizontal,
  Copy,
  ArrowUpRight,
  LogOut,
  ShieldCheck,
  Sparkles,
  Users,
  Leaf,
  BookOpen,
  Check,
  List,
  Folder,
  FolderInput,
  FolderOpen,
  ChevronRight,
  ArchiveRestore,
  Building2,
  CheckCircle2,
  BarChart3,
  Trash2,
  FolderPlus,
  Pencil,
} from "lucide-react";
import type {
  User,
  SessionSummary,
  SessionResponse,
  Role,
} from "../shared/model";
import { allBlocks, totalDuration } from "../shared/domain";
import { api, post, ApiError } from "./api";
import { useI18n } from "./i18n";
import {
  Avatar,
  Brand,
  durationLabel,
  ErrorBanner,
  LanguageSwitch,
  Loading,
  Modal,
} from "./ui";
import type { FolderListing } from "../shared/folders";
import NotificationBell from "./NotificationBell";
import { browserNavigation, type AsyncNavigation } from "./navigation";
import type { Workspace, WorkspaceSummary } from "../shared/workspaces";
import "./dashboard.css";
import "./workspaces.css";
import "./lifecycle.css";
import "./timer-recovery.css";

const Editor = lazy(() => import("./Editor"));
const PublicAgenda = lazy(() => import("./PublicAgenda"));
const PublicForm = lazy(() => import("./PublicForm"));
const RecoverAccount = lazy(() => import("./RecoverAccount"));
const ProfileSettings = lazy(() => import("./ProfileSettings"));
const AdminAccounts = lazy(() => import("./AdminAccounts"));
const WorkspacePanel = lazy(() => import("./WorkspacePanel"));
const LifecyclePanel = lazy(() => import("./LifecyclePanel"));
const ReportTrashPanel = lazy(() => import("./ReportTrashPanel"));
const FolderPanel = lazy(() => import("./FolderPanel"));
const AccountAccessOptions = lazy(() => import("./AccountAccessOptions"));
const AcceptSessionInvitation = lazy(() =>
  import("./ParticipantInvitePanel").then((module) => ({
    default: module.AcceptSessionInvitation,
  })),
);

const folderPath = (value = "") =>
  value
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean)
    .join("/");
const summaryOf = ({ session, role }: SessionResponse): SessionSummary => ({
  id: session.id,
  title: session.title,
  description: session.description,
  client: session.client,
  tags: session.tags,
  folder: session.folder,
  workspaceId: session.workspaceId,
  closedAt: session.lifecycle?.closedAt,
  unreadActivity: false,
  updatedAt: session.updatedAt,
  archived: session.archived,
  role,
  days: session.days.length,
  blocks: session.days.flatMap((day) => allBlocks(day.blocks)).length,
  duration: totalDuration(session),
});

type AuthStatus = {
  needsSetup: boolean;
  user: User | null;
  aiEnabled: boolean;
  requiresBootstrapToken?: boolean;
  oidcEnabled?: boolean;
  passwordResetEnabled?: boolean;
};
export default function App() {
  return (
    <Suspense fallback={<Loading />}>
      <AppRoutes />
    </Suspense>
  );
}
function AppRoutes() {
  const [path, setPath] = useState(location.pathname);
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [error, setError] = useState("");
  const navigation = useRef<AsyncNavigation | null>(null);
  const navigate = (url: string) => {
    void navigation.current?.navigate(url);
  };
  const refresh = () =>
    api<AuthStatus>("/auth/status")
      .then(setAuth)
      .catch((e) => setError(e.message));
  useEffect(() => {
    refresh();
    const controller = browserNavigation((url) => {
      setPath(new URL(url).pathname);
      window.scrollTo(0, 0);
    });
    navigation.current = controller;
    const stop = controller.start();
    return () => {
      stop();
      navigation.current = null;
    };
  }, []);
  const publicToken = path.match(/^\/s\/([^/]+)$/)?.[1];
  if (publicToken) return <PublicAgenda token={publicToken} />;
  const formToken = path.match(/^\/f\/([^/]+)$/)?.[1];
  if (formToken) return <PublicForm token={formToken} />;
  const recoveryToken = path.match(/^\/recover\/([^/]+)$/)?.[1];
  if (recoveryToken)
    return (
      <RecoverAccount
        token={recoveryToken}
        onSuccess={() => {
          navigate("/");
          void refresh();
        }}
      />
    );
  if (error)
    return (
      <ErrorBanner
        message={error}
        retry={() => {
          setError("");
          refresh();
        }}
      />
    );
  if (!auth) return <Loading />;
  const inviteToken = path.match(/^\/join\/([^/]+)$/)?.[1];
  if (auth.user && inviteToken)
    return (
      <main className="auth-page">
        <section className="auth-story">
          <Brand />
        </section>
        <section className="auth-form-section">
          <AcceptSessionInvitation
            token={inviteToken}
            onAccepted={() => {
              navigate("/");
              void refresh();
            }}
          />
          <button className="button quiet" onClick={() => navigate("/")}>
            MeetLoom
          </button>
        </section>
      </main>
    );
  if (!auth.user || inviteToken)
    return (
      <AuthScreen
        auth={auth}
        inviteToken={inviteToken}
        onSuccess={() => {
          navigate("/");
          refresh();
        }}
      />
    );
  const id = path.match(/^\/session\/([^/]+)$/)?.[1];
  if (id)
    return (
      <Editor
        key={id}
        id={id}
        user={auth.user}
        aiEnabled={auth.aiEnabled}
        navigate={navigate}
      />
    );
  return (
    <Dashboard
      user={auth.user}
      navigate={navigate}
      refreshUser={refresh}
      logout={async () => {
        await post("/auth/logout");
        refresh();
      }}
    />
  );
}

function AuthScreen({
  auth,
  onSuccess,
  inviteToken,
}: {
  auth: AuthStatus;
  onSuccess: () => void;
  inviteToken?: string;
}) {
  const { t, locale } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const setup = auth.needsSetup || !!inviteToken;
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    const data = Object.fromEntries(new FormData(e.currentTarget));
    try {
      await post(
        inviteToken
          ? "/auth/accept-invite"
          : auth.needsSetup
            ? "/auth/setup"
            : "/auth/login",
        { ...data, locale, token: inviteToken },
      );
      onSuccess();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="auth-page">
      <section className="auth-story">
        <Brand />
        <div>
          <span className="eyebrow">
            {t("LE TEMPS D’ÊTRE ENSEMBLE", "MAKE TIME FOR TOGETHER")}
          </span>
          <h1>
            {t(
              "De belles idées.\nDes séances\nqui avancent.",
              "Great ideas.\nMeetings that\nmove forward.",
            )}
          </h1>
          <p>
            {t(
              "Préparez chaque moment, animez sereinement et donnez au temps une place dans la conversation.",
              "Plan every moment, facilitate with confidence, and make time part of the conversation.",
            )}
          </p>
          <div className="auth-agenda">
            <div>
              <span className="mini-dot green" />
              09:00 <strong>{t("Se retrouver", "Connect")}</strong>
              <span>10 min</span>
              <Check size={16} />
            </div>
            <div>
              <span className="mini-dot purple" />
              09:10{" "}
              <strong>{t("Faire émerger les idées", "Explore ideas")}</strong>
              <span>25 min</span>
              <span className="live-dot" />
            </div>
            <div>
              <span className="mini-dot amber" />
              09:35 <strong>{t("Décider ensemble", "Decide together")}</strong>
              <span>15 min</span>
            </div>
          </div>
        </div>
        <p className="auth-footer">
          <ShieldCheck size={17} />
          {t(
            "Vos séances. Vos données. Votre espace.",
            "Your sessions. Your data. Your space.",
          )}
        </p>
      </section>
      <section className="auth-form-side">
        <div className="auth-top">
          <LanguageSwitch />
        </div>
        <form onSubmit={submit}>
          <span className="eyebrow">
            {t("BIENVENUE DANS MEETLOOM", "WELCOME TO MEETLOOM")}
          </span>
          <h2>
            {setup
              ? t("Créons votre espace.", "Make yourself at home.")
              : t("Heureux de vous retrouver.", "Good to see you again.")}
          </h2>
          <p>
            {inviteToken
              ? t(
                  "Votre invitation vous attend. Choisissez votre mot de passe.",
                  "Your invitation is ready. Choose your password.",
                )
              : auth.needsSetup
                ? t(
                    "Créez le premier compte pour commencer à préparer vos séances.",
                    "Create the first account to start planning your sessions.",
                  )
                : t(
                    "Connectez-vous pour retrouver vos séances et votre équipe.",
                    "Sign in to find your sessions and your team.",
                  )}
          </p>
          {error && <ErrorBanner message={error} />}
          {setup && (
            <label>
              {t("Votre nom", "Your name")}
              <input
                name="name"
                required
                maxLength={100}
                autoComplete="name"
                placeholder="Camille Martin"
              />
            </label>
          )}
          {!inviteToken && (
            <label>
              {t("Adresse e-mail", "Email address")}
              <input
                name="email"
                type="email"
                required
                autoComplete="email"
                placeholder="camille@organisation.ch"
              />
            </label>
          )}
          <label>
            {t("Mot de passe", "Password")}
            <input
              name="password"
              type="password"
              required
              minLength={setup ? 12 : undefined}
              maxLength={200}
              autoComplete={setup ? "new-password" : "current-password"}
              placeholder={
                setup
                  ? t("12 caractères minimum", "At least 12 characters")
                  : "••••••••••••"
              }
            />
          </label>
          {auth.needsSetup && auth.requiresBootstrapToken && (
            <label>
              {t("Clé d’installation", "Installation key")}
              <input
                name="bootstrapToken"
                type="password"
                required
                autoComplete="off"
              />
              <small>
                {t(
                  "Fournie par la personne qui a installé MeetLoom.",
                  "Provided by the person who installed MeetLoom.",
                )}
              </small>
            </label>
          )}
          <button className="button primary full" disabled={busy}>
            {busy
              ? t("Un instant…", "One moment…")
              : setup
                ? t("Créer mon compte", "Create my account")
                : t("Se connecter", "Sign in")}
            <ArrowRight size={18} />
          </button>
          <p className="auth-note">
            <ShieldCheck size={15} />
            {t(
              "Hébergé dans votre organisation. Aucune publicité.",
              "Hosted in your organization. No advertising.",
            )}
          </p>
        </form>
        {!setup &&
          !inviteToken &&
          (auth.oidcEnabled || auth.passwordResetEnabled) && (
            <Suspense fallback={<Loading />}>
              <AccountAccessOptions
                oidcEnabled={auth.oidcEnabled}
                passwordResetEnabled={auth.passwordResetEnabled}
              />
            </Suspense>
          )}
      </section>
    </main>
  );
}

function Dashboard({
  user,
  navigate,
  logout,
  refreshUser,
}: {
  user: User;
  navigate: (url: string) => void;
  logout: () => void;
  refreshUser: () => void;
}) {
  const { t, locale } = useI18n();
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [workspaceId, setWorkspaceId] = useState("all");
  const [workspacePanel, setWorkspacePanel] = useState("");
  const [lifecycleSession, setLifecycleSession] =
    useState<SessionResponse | null>(null);
  const [reportTrash, setReportTrash] = useState<"report" | "trash" | null>(
    null,
  );
  const [workspaceCreate, setWorkspaceCreate] = useState(false);
  const [workspaceMove, setWorkspaceMove] = useState<SessionSummary | null>(
    null,
  );
  const [destinationWorkspace, setDestinationWorkspace] = useState("");
  const selectedWorkspace = workspaces.find(
    (workspace) => workspace.id === workspaceId,
  );
  const canCreate =
    !selectedWorkspace || ["admin", "editor"].includes(selectedWorkspace.role);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [archived, setArchived] = useState(false);
  const [view, setView] = useState<"cards" | "list">("cards");
  const [sort, setSort] = useState("updated");
  const [roleFilter, setRoleFilter] = useState<Role | "">("");
  const [activityFilter, setActivityFilter] = useState<
    "all" | "unread" | "recent"
  >("all");
  const [folder, setFolder] = useState<string | null>(null);
  const [folderListing, setFolderListing] = useState<FolderListing>({
    version: 0,
    folders: [],
    editable: true,
  });
  const [folderMode, setFolderMode] = useState<
    "create" | "rename" | "delete" | null
  >(null);
  const loadFolders = async () => {
    if (selectedWorkspace?.role === "guest") {
      setFolderListing({ version: 0, folders: [], editable: false });
      return;
    }
    setFolderListing(
      await api<FolderListing>(
        `/folders${selectedWorkspace ? `?workspaceId=${selectedWorkspace.id}` : ""}`,
      ),
    );
  };
  useEffect(() => {
    setFolderListing({ version: 0, folders: [], editable: false });
    void loadFolders().catch((e) => setError(e.message));
  }, [workspaceId, selectedWorkspace?.role]);
  const [moving, setMoving] = useState<SessionSummary | null>(null);
  const [moveTo, setMoveTo] = useState("");
  const [moveError, setMoveError] = useState("");
  const [mutationId, setMutationId] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [create, setCreate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [account, setAccount] = useState(false);
  const [createdInvite, setCreatedInvite] = useState("");
  const [inviteError, setInviteError] = useState("");
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteCopied, setInviteCopied] = useState(false);
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordError, setPasswordError] = useState("");
  const [passwordChanged, setPasswordChanged] = useState(false);
  const refreshDashboard = async () => {
    const [agenda, spaces] = await Promise.all([
      api<{ sessions: SessionSummary[] }>("/sessions"),
      api<{ workspaces: WorkspaceSummary[] }>("/workspaces"),
    ]);
    setSessions(agenda.sessions);
    setWorkspaces(spaces.workspaces);
    setWorkspaceId((current) =>
      current === "all" ||
      current === "personal" ||
      spaces.workspaces.some((space) => space.id === current)
        ? current
        : "all",
    );
  };
  useEffect(() => {
    void refreshDashboard()
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    const closeMenus = (event: Event) => {
      if (event instanceof KeyboardEvent && event.key !== "Escape") return;
      document
        .querySelectorAll<HTMLDetailsElement>(".session-actions[open]")
        .forEach((menu) => {
          if (
            event instanceof KeyboardEvent ||
            !menu.contains(event.target as Node)
          ) {
            menu.open = false;
            if (
              event instanceof KeyboardEvent &&
              menu.contains(document.activeElement)
            )
              menu.querySelector<HTMLElement>("summary")?.focus();
          }
        });
    };
    document.addEventListener("pointerdown", closeMenus);
    document.addEventListener("keydown", closeMenus);
    return () => {
      document.removeEventListener("pointerdown", closeMenus);
      document.removeEventListener("keydown", closeMenus);
    };
  }, []);
  const mutationMessage = (error: unknown) =>
    error instanceof ApiError && error.code === "VERSION_CONFLICT"
      ? t(
          "Cette séance a été modifiée pendant l’opération. Réessayez pour appliquer votre changement à sa dernière version.",
          "This session changed during the operation. Retry to apply your change to its latest version.",
        )
      : (error as Error).message;
  const newSession = async (
    title: string,
    demo = false,
    destination = folder ?? "",
  ) => {
    setBusy(true);
    setError("");
    let created: SessionResponse | undefined;
    try {
      created = await post<SessionResponse>("/sessions", {
        title,
        locale,
        demo,
        workspaceId: selectedWorkspace?.id,
      });
      if (folderPath(destination)) {
        created = await api<SessionResponse>(
          `/sessions/${created.session.id}`,
          {
            method: "PUT",
            body: JSON.stringify({
              session: { ...created.session, folder: folderPath(destination) },
              version: created.session.version,
            }),
          },
        );
      }
      navigate(`/session/${created.session.id}`);
    } catch (e) {
      if (created) {
        setSessions((previous) => [summaryOf(created!), ...previous]);
        setCreate(false);
        setFolder(null);
        setArchived(false);
        setFilter("");
        setRoleFilter("");
        setError(
          t(
            "La séance a été créée, mais son classement a échoué. Vous pouvez la déplacer depuis le tableau. ",
            "The session was created, but filing it failed. You can move it from the dashboard. ",
          ) + (e as Error).message,
        );
      } else setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const replaceSummary = (response: SessionResponse) => {
    void post(`/sessions/${response.session.id}/view`, {
      version: response.session.version,
    }).catch(() => {});
    setSessions((previous) =>
      previous.map((item) =>
        item.id === response.session.id ? summaryOf(response) : item,
      ),
    );
  };
  const updateSession = async (
    id: string,
    patch: { folder?: string; archived?: boolean },
  ) => {
    const latest = await api<SessionResponse>(`/sessions/${id}`);
    const response = await api<SessionResponse>(`/sessions/${id}`, {
      method: "PUT",
      body: JSON.stringify({
        session: { ...latest.session, ...patch },
        version: latest.session.version,
      }),
    });
    replaceSummary(response);
    if (patch.folder !== undefined)
      void loadFolders().catch((e) => setError(e.message));
    return response;
  };
  const archiveSession = async (session: SessionSummary) => {
    setMutationId(session.id);
    setError("");
    setNotice("");
    try {
      await updateSession(session.id, { archived: !session.archived });
      setNotice(
        session.archived
          ? t("Séance restaurée.", "Session restored.")
          : t(
              "Séance archivée. Retrouvez-la dans les archives.",
              "Session archived. Find it in the archive.",
            ),
      );
    } catch (e) {
      setError(mutationMessage(e));
    } finally {
      setMutationId("");
    }
  };
  const roleLabel = (role: Role) =>
    ({
      owner: t("Propriétaire", "Owner"),
      editor: t("Éditeur", "Editor"),
      facilitator: t("Animateur", "Facilitator"),
      viewer: t("Lecteur", "Viewer"),
    })[role];
  const workspaceSessions = sessions.filter(
    (session) =>
      workspaceId === "all" ||
      (workspaceId === "personal"
        ? !session.workspaceId
        : session.workspaceId === workspaceId),
  );
  const inArchive = workspaceSessions.filter(
    (session) => session.archived === archived,
  );
  const allFolders = [
    ...new Set([
      ...folderListing.folders,
      ...workspaceSessions.flatMap((session) => {
        const parts = folderPath(session.folder).split("/").filter(Boolean);
        return parts.map((_, index) => parts.slice(0, index + 1).join("/"));
      }),
    ]),
  ].sort((a, b) => a.localeCompare(b, locale));
  const folderContents = (path: string) =>
    inArchive.filter(
      (session) =>
        folderPath(session.folder) === path ||
        folderPath(session.folder).startsWith(`${path}/`),
    );
  const childFolders =
    folder === null
      ? []
      : allFolders.filter((path) => {
          const parent = path.includes("/")
            ? path.slice(0, path.lastIndexOf("/"))
            : "";
          return parent === folder;
        });
  const query = filter.trim().toLocaleLowerCase(locale);
  const visible = inArchive
    .filter(
      (session) =>
        (folder === null || folderPath(session.folder) === folder) &&
        (!roleFilter || session.role === roleFilter) &&
        (activityFilter === "all" ||
          (activityFilter === "unread"
            ? session.unreadActivity
            : !!session.lastViewedAt)) &&
        `${session.title} ${session.description} ${session.client ?? ""} ${(session.tags ?? []).join(" ")}`
          .toLocaleLowerCase(locale)
          .includes(query),
    )
    .sort((a, b) =>
      activityFilter === "recent"
        ? (b.lastViewedAt ?? "").localeCompare(a.lastViewedAt ?? "")
        : sort === "title"
          ? a.title.localeCompare(b.title, locale)
          : sort === "duration"
            ? a.duration - b.duration
            : sort === "duration-desc"
              ? b.duration - a.duration
              : b.updatedAt.localeCompare(a.updatedAt),
    );
  const activeSessions = workspaceSessions.filter((s) => !s.archived);
  const sessionActions = (session: SessionSummary) => (
    <details className="session-actions">
      <summary
        className="icon-button"
        aria-label={t(
          `Actions pour ${session.title}`,
          `Actions for ${session.title}`,
        )}
        title={t("Actions", "Actions")}
      >
        <MoreHorizontal size={18} />
      </summary>
      <div className="session-action-menu">
        <button
          disabled={!!mutationId}
          onClick={(event) => {
            event.currentTarget.closest("details")?.removeAttribute("open");
            setMutationId(session.id);
            void api<SessionResponse>(`/sessions/${session.id}`)
              .then(setLifecycleSession)
              .catch((error) => setError(error.message))
              .finally(() => setMutationId(""));
          }}
        >
          <CheckCircle2 size={16} />
          {session.closedAt
            ? t("État / rouvrir", "Status / reopen")
            : t("Clôturer / supprimer", "Close / delete")}
        </button>
        {session.role === "owner" && (
          <button
            onClick={(event) => {
              event.currentTarget.closest("details")?.removeAttribute("open");
              setWorkspaceMove(session);
              setDestinationWorkspace(session.workspaceId ?? "");
              setMoveError("");
            }}
          >
            <Building2 size={16} />
            {t("Changer d’espace", "Change workspace")}
          </button>
        )}
        <button
          disabled={Boolean(mutationId)}
          onClick={async (event) => {
            event.currentTarget.closest("details")?.removeAttribute("open");
            setMutationId(session.id);
            setError("");
            try {
              const response = await post<SessionResponse>(
                `/sessions/${session.id}/duplicate`,
              );
              navigate(`/session/${response.session.id}`);
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setMutationId("");
            }
          }}
        >
          <Copy size={16} />
          {t("Dupliquer", "Duplicate")}
        </button>
        {!session.closedAt && ["owner", "editor"].includes(session.role) && (
          <>
            <button
              disabled={Boolean(mutationId)}
              onClick={(event) => {
                event.currentTarget.closest("details")?.removeAttribute("open");
                setMoving(session);
                setMoveTo(folderPath(session.folder));
                setMoveError("");
              }}
            >
              <FolderInput size={16} />
              {t("Déplacer dans un dossier", "Move to a folder")}
            </button>
            <button
              disabled={Boolean(mutationId)}
              onClick={(event) => {
                event.currentTarget.closest("details")?.removeAttribute("open");
                void archiveSession(session);
              }}
            >
              {session.archived ? (
                <ArchiveRestore size={16} />
              ) : (
                <Archive size={16} />
              )}
              {session.archived
                ? t("Restaurer", "Restore")
                : t("Archiver", "Archive")}
            </button>
          </>
        )}
      </div>
    </details>
  );
  return (
    <div className="app-shell dashboard-shell">
      <aside className="sidebar">
        <a
          href="/"
          className="brand-link"
          onClick={(e) => {
            e.preventDefault();
            navigate("/");
          }}
        >
          <Brand />
        </a>
        <div className="workspace-selector">
          <label htmlFor="workspace-switcher">
            {t("ESPACE DE TRAVAIL", "WORKSPACE")}
          </label>
          <select
            id="workspace-switcher"
            value={workspaceId}
            onChange={(e) => {
              setWorkspaceId(e.target.value);
              setFolder(null);
              setFilter("");
            }}
          >
            <option value="all">
              {t("Tous mes espaces", "All my workspaces")}
            </option>
            <option value="personal">
              {t("Séances personnelles", "Personal sessions")}
            </option>
            {workspaces.map((workspace) => (
              <option key={workspace.id} value={workspace.id}>
                {workspace.name}
                {workspace.role === "guest" ? t(" (invité)", " (guest)") : ""}
              </option>
            ))}
          </select>
          <div className="workspace-selector-actions">
            <button
              className="button secondary"
              onClick={() => {
                setWorkspaceCreate(true);
                setMoveError("");
              }}
            >
              <Plus size={13} />
              {t("Créer un espace", "Create workspace")}
            </button>
            {selectedWorkspace?.role === "admin" && (
              <button
                className="button quiet"
                onClick={() => setWorkspacePanel(workspaceId)}
              >
                {t("Gérer", "Manage")}
              </button>
            )}
          </div>
        </div>
        <div className="workspace-card">
          <span className="workspace-icon">
            {selectedWorkspace?.logo ? (
              <img
                src={selectedWorkspace.logo}
                alt=""
                className="workspace-small-logo"
              />
            ) : (
              <Leaf size={19} />
            )}
          </span>
          <div>
            <strong>
              {selectedWorkspace?.name ?? t("Mon espace", "My workspace")}
            </strong>
            <span>
              {selectedWorkspace?.organization ||
                t("Personnel & équipe", "Personal & team")}
            </span>
          </div>
        </div>
        <nav>
          <button className="nav-item" onClick={() => setReportTrash("report")}>
            <BarChart3 size={18} />
            {t("Rapport des séances", "Session report")}
          </button>
          <button className="nav-item" onClick={() => setReportTrash("trash")}>
            <Trash2 size={18} />
            {t("Corbeille", "Trash")}
          </button>
          <button
            className={!archived ? "nav-item active" : "nav-item"}
            onClick={() => {
              setArchived(false);
              setFolder(null);
            }}
          >
            <LayoutGrid size={18} />
            {t("Mes séances", "My sessions")}
            <span className="nav-count">{activeSessions.length}</span>
          </button>
          <button
            className={archived ? "nav-item active" : "nav-item"}
            onClick={() => {
              setArchived(true);
              setFolder(null);
            }}
          >
            <Archive size={18} />
            {t("Archives", "Archive")}
          </button>
          <button className="nav-item" onClick={() => setAccount(true)}>
            <Users size={18} />
            {t("Mon compte & équipe", "Account & team")}
          </button>
        </nav>
        <nav
          className="dashboard-folders"
          aria-label={t("Dossiers", "Folders")}
        >
          <span className="nav-caption">{t("DOSSIERS", "FOLDERS")}</span>
          <button
            className={`folder-link ${folder === null ? "selected" : ""}`}
            onClick={() => setFolder(null)}
            aria-current={folder === null ? "page" : undefined}
          >
            <LayoutGrid size={16} />
            <span>{t("Tous les dossiers", "All folders")}</span>
          </button>
          <button
            className={`folder-link ${folder === "" ? "selected" : ""}`}
            onClick={() => setFolder("")}
            aria-current={folder === "" ? "page" : undefined}
          >
            <FolderOpen size={16} />
            <span>{t("Sans dossier", "Unfiled")}</span>
            <small>
              {
                inArchive.filter((session) => !folderPath(session.folder))
                  .length
              }
            </small>
          </button>
          {allFolders.map((path) => (
            <button
              key={path}
              className={`folder-link ${folder === path ? "selected" : ""}`}
              style={{
                paddingLeft: 12 + Math.min(path.split("/").length - 1, 5) * 12,
              }}
              onClick={() => setFolder(path)}
              aria-current={folder === path ? "page" : undefined}
              title={path}
            >
              <Folder size={16} />
              <span>{path.split("/").at(-1)}</span>
              <small>{folderContents(path).length}</small>
            </button>
          ))}
          <p className="folder-note">
            {t(
              "Les dossiers et sous-dossiers vides sont conservés. Sélectionnez un espace pour les gérer.",
              "Empty folders and subfolders are retained. Select a workspace to manage them.",
            )}
          </p>
        </nav>
        <div className="sidebar-user">
          <Avatar src={user.avatar} name={user.name} />
          <div>
            <strong>{user.name}</strong>
            <small>{t("Mon compte", "My account")}</small>
          </div>
          <button
            className="icon-button"
            title={t("Se déconnecter", "Sign out")}
            onClick={logout}
          >
            <LogOut size={17} />
          </button>
        </div>
      </aside>
      <main className="dashboard-main">
        <header className="topbar">
          <div className="breadcrumb">
            {selectedWorkspace?.name ?? t("Mon espace", "My workspace")}
            <span>/</span>
            <strong>
              {archived
                ? t("Archives", "Archive")
                : t("Mes séances", "My sessions")}
            </strong>
          </div>
          <div className="topbar-actions">
            <NotificationBell
              onNavigate={(sid, bid, cid) => {
                const search = new URLSearchParams();
                if (bid) search.set("block", bid);
                if (cid) search.set("comment", cid);
                navigate(`/session/${sid}${search.size ? `?${search}` : ""}`);
              }}
            />
            <span className="privacy-badge">
              <span />
              {t("Espace privé", "Private workspace")}
            </span>
            <LanguageSwitch />
            <Avatar src={user.avatar} name={user.name} small />
          </div>
        </header>
        <div className="dashboard-content">
          <div className="dashboard-intro">
            <div>
              <span className="eyebrow">
                {new Intl.DateTimeFormat(locale, {
                  weekday: "long",
                  day: "numeric",
                  month: "long",
                })
                  .format(new Date())
                  .toUpperCase()}
              </span>
              <h1>
                {archived
                  ? t("Vos séances archivées", "Your archived sessions")
                  : t(
                      `Bonjour ${user.name.split(" ")[0]} 👋`,
                      `Hello ${user.name.split(" ")[0]} 👋`,
                    )}
              </h1>
              <p>
                {t(
                  "Un peu de préparation. Beaucoup de place pour l’essentiel.",
                  "A little preparation. More room for what matters.",
                )}
              </p>
            </div>
            <button
              className="button primary"
              disabled={!canCreate}
              onClick={() => setCreate(true)}
            >
              <Plus size={19} />
              {t("Nouvelle séance", "New session")}
            </button>
          </div>
          {error && <ErrorBanner message={error} />}
          {notice && (
            <p className="dashboard-notice" role="status">
              <Check size={16} />
              {notice}
            </p>
          )}
          {!archived && folder === null && (
            <div className="welcome-banner">
              <div>
                <span className="banner-tag">
                  <Sparkles size={14} />
                  {t("CHAQUE MINUTE A DU SENS", "MAKE EVERY MINUTE COUNT")}
                </span>
                <h2>
                  {t(
                    "Les bonnes séances se tissent ensemble.",
                    "Great sessions come together.",
                  )}
                </h2>
                <p>
                  {t(
                    "Composez un agenda clair, partagez les bons détails\net gardez le fil, du premier mot à la dernière décision.",
                    "Build a clear agenda, share the right details,\nand keep everyone on track from start to finish.",
                  )}
                </p>
                <button
                  className="text-button"
                  onClick={() =>
                    newSession(
                      t("Atelier de lancement", "Kick-off workshop"),
                      true,
                    )
                  }
                  disabled={busy || !canCreate}
                >
                  {t("Explorer un exemple", "Explore an example")}
                  <ArrowUpRight size={17} />
                </button>
              </div>
              <div className="banner-illustration" aria-hidden="true">
                <div className="illustration-orbit" />
                <div className="illustration-card card-back">
                  <span />
                  <span />
                  <span />
                </div>
                <div className="illustration-card card-front">
                  <div className="illustration-label">
                    <span className="mini-dot green" />
                    09:00 — 10:30
                  </div>
                  <div className="illustration-row">
                    <span className="mini-dot green" />
                    <span />
                    <b>10′</b>
                  </div>
                  <div className="illustration-row">
                    <span className="mini-dot purple" />
                    <span />
                    <b>25′</b>
                  </div>
                  <div className="illustration-row">
                    <span className="mini-dot amber" />
                    <span />
                    <b>15′</b>
                  </div>
                  <div className="illustration-line" />
                </div>
                <span className="illustration-check">
                  <Check size={20} />
                </span>
                <span className="illustration-star">✳</span>
              </div>
            </div>
          )}
          <div className="section-heading dashboard-section-heading">
            <div>
              <h2>
                {folder !== null
                  ? folder.split("/").at(-1) || t("Sans dossier", "Unfiled")
                  : archived
                    ? t("Archives", "Archive")
                    : t("Vos séances", "Your sessions")}
              </h2>
              <span className="count-badge">{visible.length}</span>
            </div>
            <label className="search-field">
              <Search size={17} />
              <input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder={t(
                  "Titre, client, étiquette…",
                  "Title, client, tag…",
                )}
                aria-label={t(
                  "Rechercher par titre, description, client ou étiquette",
                  "Search by title, description, client or tag",
                )}
              />
            </label>
          </div>
          <div className="dashboard-toolbar">
            <nav
              className="folder-breadcrumb"
              aria-label={t("Emplacement", "Location")}
            >
              <button onClick={() => setFolder(null)}>
                {t("Toutes les séances", "All sessions")}
              </button>
              <ChevronRight size={14} />
              <button onClick={() => setFolder("")}>
                <Folder size={14} />
                {t("Dossiers", "Folders")}
              </button>
              {(folder || "")
                .split("/")
                .filter(Boolean)
                .map((part, index, parts) => (
                  <span key={index}>
                    <ChevronRight size={14} />
                    <button
                      onClick={() =>
                        setFolder(parts.slice(0, index + 1).join("/"))
                      }
                    >
                      {part}
                    </button>
                  </span>
                ))}
            </nav>
            <div className="dashboard-controls">
              <label>
                <span>{t("Activité", "Activity")}</span>
                <select
                  value={activityFilter}
                  onChange={(event) =>
                    setActivityFilter(
                      event.target.value as typeof activityFilter,
                    )
                  }
                >
                  <option value="all">
                    {t("Toutes les séances", "All sessions")}
                  </option>
                  <option value="unread">
                    {t("Modifications non lues", "Unread changes")}
                  </option>
                  <option value="recent">
                    {t("Ouvertes récemment", "Recently opened")}
                  </option>
                </select>
              </label>
              <div className="folder-manage-actions">
                <button
                  className="icon-button"
                  title={t("Créer un dossier", "Create folder")}
                  aria-label={t("Créer un dossier", "Create folder")}
                  disabled={!folderListing.editable}
                  onClick={() => {
                    if (workspaceId === "all") setWorkspaceId("personal");
                    setFolderMode("create");
                  }}
                >
                  <FolderPlus size={17} />
                </button>
                {!!folder &&
                  workspaceId !== "all" &&
                  folderListing.editable && (
                    <>
                      <button
                        className="icon-button"
                        title={t("Renommer le dossier", "Rename folder")}
                        aria-label={t("Renommer le dossier", "Rename folder")}
                        onClick={() => setFolderMode("rename")}
                      >
                        <Pencil size={16} />
                      </button>
                      <button
                        className="icon-button"
                        title={t(
                          "Supprimer le dossier vide",
                          "Delete empty folder",
                        )}
                        aria-label={t(
                          "Supprimer le dossier vide",
                          "Delete empty folder",
                        )}
                        onClick={() => setFolderMode("delete")}
                      >
                        <Trash2 size={16} />
                      </button>
                    </>
                  )}
              </div>
              <label>
                <span>{t("Mon rôle", "My role")}</span>
                <select
                  value={roleFilter}
                  onChange={(event) =>
                    setRoleFilter(event.target.value as Role | "")
                  }
                >
                  <option value="">{t("Tous les rôles", "All roles")}</option>
                  {(["owner", "editor", "facilitator", "viewer"] as Role[]).map(
                    (role) => (
                      <option key={role} value={role}>
                        {roleLabel(role)}
                      </option>
                    ),
                  )}
                </select>
              </label>
              <label>
                <span>{t("Trier par", "Sort by")}</span>
                <select
                  value={sort}
                  onChange={(event) => setSort(event.target.value)}
                >
                  <option value="updated">
                    {t("Modification récente", "Recently updated")}
                  </option>
                  <option value="title">{t("Titre A–Z", "Title A–Z")}</option>
                  <option value="duration">
                    {t("Durée croissante", "Shortest first")}
                  </option>
                  <option value="duration-desc">
                    {t("Durée décroissante", "Longest first")}
                  </option>
                </select>
              </label>
              <div
                className="dashboard-view-switch"
                role="group"
                aria-label={t("Affichage", "View")}
              >
                <button
                  aria-pressed={view === "cards"}
                  aria-label={t("Vue cartes", "Card view")}
                  title={t("Vue cartes", "Card view")}
                  onClick={() => setView("cards")}
                >
                  <LayoutGrid size={18} />
                </button>
                <button
                  aria-pressed={view === "list"}
                  aria-label={t("Vue liste", "List view")}
                  title={t("Vue liste", "List view")}
                  onClick={() => setView("list")}
                >
                  <List size={18} />
                </button>
              </div>
            </div>
          </div>
          {childFolders.length > 0 && (
            <div
              className="folder-tiles"
              aria-label={t("Sous-dossiers", "Subfolders")}
            >
              {childFolders.map((path) => (
                <button key={path} onClick={() => setFolder(path)}>
                  <Folder size={19} />
                  <span>
                    {path.split("/").at(-1)}
                    <small>
                      {folderContents(path).length} {t("séances", "sessions")}
                    </small>
                  </span>
                  <ChevronRight size={16} />
                </button>
              ))}
            </div>
          )}
          {loading ? (
            <Loading />
          ) : visible.length ? (
            view === "list" ? (
              <div className="session-list-wrap">
                <table className="session-list">
                  <caption className="dashboard-sr-only">
                    {t(
                      "Séances correspondant aux filtres",
                      "Sessions matching the filters",
                    )}
                  </caption>
                  <thead>
                    <tr>
                      <th>{t("Séance", "Session")}</th>
                      <th>{t("Durée", "Duration")}</th>
                      <th>{t("Mon rôle", "My role")}</th>
                      <th>{t("Modification", "Updated")}</th>
                      <th>
                        <span className="dashboard-sr-only">
                          {t("Actions", "Actions")}
                        </span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((session) => (
                      <tr key={session.id}>
                        <td>
                          <button
                            className="session-list-title"
                            onClick={() => navigate(`/session/${session.id}`)}
                          >
                            {session.title}
                            {session.unreadActivity && (
                              <span
                                className="unread-session-dot"
                                title={t(
                                  "Modifications non lues",
                                  "Unread changes",
                                )}
                                aria-label={t(
                                  "Modifications non lues",
                                  "Unread changes",
                                )}
                              />
                            )}
                            {session.closedAt && (
                              <span className="closed-session-badge">
                                {t("Clôturée", "Closed")}
                              </span>
                            )}
                          </button>
                          <p>
                            {session.description ||
                              t("Aucune description", "No description")}
                          </p>
                          <div className="session-labels">
                            {session.client && (
                              <span className="session-client">
                                <Building2 size={13} />
                                {session.client}
                              </span>
                            )}
                            {session.tags?.map((tag) => (
                              <span key={tag} className="session-tag">
                                {tag}
                              </span>
                            ))}
                          </div>
                          {session.folder && (
                            <button
                              className="session-folder"
                              onClick={() =>
                                setFolder(folderPath(session.folder))
                              }
                            >
                              <Folder size={13} />
                              {folderPath(session.folder)}
                            </button>
                          )}
                        </td>
                        <td>
                          <strong>{durationLabel(session.duration)}</strong>
                          <small>
                            {session.blocks} {t("blocs", "blocks")} ·{" "}
                            {session.days}{" "}
                            {t(
                              session.days > 1 ? "jours" : "jour",
                              session.days > 1 ? "days" : "day",
                            )}
                          </small>
                        </td>
                        <td>
                          <span className={`session-role role-${session.role}`}>
                            {roleLabel(session.role)}
                          </span>
                        </td>
                        <td>
                          <time dateTime={session.updatedAt}>
                            {new Date(session.updatedAt).toLocaleDateString(
                              locale,
                              {
                                day: "numeric",
                                month: "short",
                                year: "numeric",
                              },
                            )}
                          </time>
                        </td>
                        <td>{sessionActions(session)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="session-grid">
                {visible.map((s) => (
                  <article className="session-card" key={s.id}>
                    <div className="session-card-top">
                      <span className="session-type">
                        <CalendarDays size={17} />
                        {t("SÉANCE", "SESSION")}
                      </span>
                      {sessionActions(s)}
                    </div>
                    <button
                      className="session-card-title"
                      onClick={() => navigate(`/session/${s.id}`)}
                    >
                      {s.title}
                      {s.unreadActivity && (
                        <span
                          className="unread-session-dot"
                          title={t("Modifications non lues", "Unread changes")}
                          aria-label={t(
                            "Modifications non lues",
                            "Unread changes",
                          )}
                        />
                      )}
                      {s.closedAt && (
                        <span className="closed-session-badge">
                          {t("Clôturée", "Closed")}
                        </span>
                      )}
                    </button>
                    <p>
                      {s.description ||
                        t(
                          "Un nouvel espace pour vos idées.",
                          "A fresh space for your ideas.",
                        )}
                    </p>
                    <div className="session-labels card-labels">
                      {s.client && (
                        <span className="session-client">
                          <Building2 size={13} />
                          {s.client}
                        </span>
                      )}
                      {s.tags?.map((tag) => (
                        <span key={tag} className="session-tag">
                          {tag}
                        </span>
                      ))}
                    </div>
                    <div className="session-card-context">
                      <span className={`session-role role-${s.role}`}>
                        {roleLabel(s.role)}
                      </span>
                      {s.folder && (
                        <button
                          className="session-folder"
                          onClick={() => setFolder(folderPath(s.folder))}
                        >
                          <Folder size={13} />
                          {folderPath(s.folder)}
                        </button>
                      )}
                    </div>
                    <div className="session-meta">
                      <span>
                        <Clock3 size={15} />
                        {durationLabel(s.duration)}
                      </span>
                      <span>
                        {s.blocks} {t("blocs", "blocks")}
                      </span>
                      <span>
                        {s.days}{" "}
                        {t(
                          s.days > 1 ? "jours" : "jour",
                          s.days > 1 ? "days" : "day",
                        )}
                      </span>
                    </div>
                    <div className="session-card-bottom">
                      <Avatar src={user.avatar} name={user.name} small />
                      <span>
                        {t("Modifiée le ", "Updated ")}
                        {new Date(s.updatedAt).toLocaleDateString(locale, {
                          day: "numeric",
                          month: "short",
                        })}
                      </span>
                      <button
                        className="icon-button"
                        onClick={() => navigate(`/session/${s.id}`)}
                        aria-label={t("Ouvrir la séance", "Open session")}
                      >
                        <ArrowUpRight size={18} />
                      </button>
                    </div>
                  </article>
                ))}
                {!archived && (
                  <button
                    className="new-session-card"
                    disabled={!canCreate}
                    onClick={() => setCreate(true)}
                  >
                    <span>
                      <Plus size={24} />
                    </span>
                    <strong>{t("Une nouvelle idée ?", "A new idea?")}</strong>
                    <small>{t("Préparer une séance", "Plan a session")}</small>
                  </button>
                )}
              </div>
            )
          ) : (
            <div className="empty-state">
              <span className="empty-icon">
                <BookOpen size={29} />
              </span>
              <h3>
                {filter || roleFilter
                  ? t("Aucune séance trouvée", "No sessions found")
                  : childFolders.length
                    ? t("Ouvrez un sous-dossier", "Open a subfolder")
                    : folder !== null
                      ? t(
                          "Aucune séance à cet emplacement",
                          "No sessions in this location",
                        )
                      : archived
                        ? t("Vos archives sont vides", "Your archive is empty")
                        : t(
                            "Votre prochaine séance commence ici",
                            "Your next session starts here",
                          )}
              </h3>
              <p>
                {filter || roleFilter
                  ? t(
                      "Essayez un autre terme ou changez le filtre de rôle.",
                      "Try another search term or change the role filter.",
                    )
                  : folder !== null
                    ? t(
                        "Ce dossier est vide. Vous pouvez créer une séance ici, gérer le dossier ou revenir à tous les dossiers.",
                        "This folder is empty. Create a session here, manage the folder, or return to all folders.",
                      )
                    : t(
                        "Une réunion d’équipe, un atelier, une journée de travail…",
                        "A team meeting, a workshop, a working day…",
                      )}
              </p>
              {(filter || roleFilter) && (
                <button
                  className="button secondary"
                  onClick={() => {
                    setFilter("");
                    setRoleFilter("");
                  }}
                >
                  {t("Effacer les filtres", "Clear filters")}
                </button>
              )}
              {!filter && !roleFilter && !archived && (
                <div className="button-row">
                  <button
                    className="button primary"
                    disabled={!canCreate}
                    onClick={() => setCreate(true)}
                  >
                    <Plus size={17} />
                    {t("Créer une séance", "Create a session")}
                  </button>
                  <button
                    className="button secondary"
                    disabled={busy || !canCreate}
                    onClick={() =>
                      newSession(
                        t("Atelier de lancement", "Kick-off workshop"),
                        true,
                      )
                    }
                  >
                    {t("Essayer avec un exemple", "Try an example")}
                  </button>
                </div>
              )}
            </div>
          )}
          <footer className="dashboard-footer">
            <Brand compact />
            <span>
              {t(
                "Bien préparer. Mieux se retrouver.",
                "Plan thoughtfully. Meet meaningfully.",
              )}
            </span>
            <span>
              MeetLoom · {t("Libre & auto-hébergé", "Open & self-hosted")}
            </span>
          </footer>
        </div>
      </main>
      <datalist id="dashboard-folder-options">
        {allFolders.map((path) => (
          <option key={path} value={path} />
        ))}
      </datalist>
      <Suspense
        fallback={
          <Modal
            title={t("Chargement…", "Loading…")}
            close={() => {
              setFolderMode(null);
              setLifecycleSession(null);
              setReportTrash(null);
              setWorkspacePanel("");
            }}
          >
            <Loading />
          </Modal>
        }
      >
        {folderMode && (
          <FolderPanel
            mode={folderMode}
            source={folder ?? ""}
            workspaceId={selectedWorkspace?.id}
            close={() => setFolderMode(null)}
            onChanged={(path) => {
              setFolderMode(null);
              setFolder(path);
              void Promise.all([refreshDashboard(), loadFolders()]).catch((e) =>
                setError(e.message),
              );
            }}
          />
        )}
        {lifecycleSession && (
          <LifecyclePanel
            session={lifecycleSession.session}
            role={lifecycleSession.role}
            user={user}
            close={() => setLifecycleSession(null)}
            reload={refreshDashboard}
            onDeleted={() => {
              void refreshDashboard().catch((e) => setError(e.message));
            }}
          />
        )}
        {reportTrash && (
          <ReportTrashPanel
            mode={reportTrash}
            close={() => setReportTrash(null)}
            navigate={navigate}
            onChanged={() =>
              void refreshDashboard().catch((e) => setError(e.message))
            }
            workspaceId={selectedWorkspace?.id}
          />
        )}
        {workspacePanel && (
          <WorkspacePanel
            id={workspacePanel}
            sessions={sessions}
            close={() => setWorkspacePanel("")}
            onChanged={() =>
              void refreshDashboard().catch((e) => setError(e.message))
            }
          />
        )}
      </Suspense>
      {workspaceCreate && (
        <Modal
          title={t("Créer un espace de travail", "Create workspace")}
          close={() => {
            if (!busy) setWorkspaceCreate(false);
          }}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const name = String(
                new FormData(event.currentTarget).get("name"),
              );
              setBusy(true);
              setMoveError("");
              void post<{ workspace: Workspace }>("/workspaces", { name })
                .then(async (result) => {
                  await refreshDashboard();
                  setWorkspaceId(result.workspace.id);
                  setFolder(null);
                  setWorkspaceCreate(false);
                  setWorkspacePanel(result.workspace.id);
                })
                .catch((e) => setMoveError(e.message))
                .finally(() => setBusy(false));
            }}
          >
            <label>
              {t("Nom de l’espace", "Workspace name")}
              <input
                name="name"
                required
                maxLength={200}
                autoFocus
                placeholder={t(
                  "Ex. Équipe facilitation",
                  "e.g. Facilitation team",
                )}
              />
            </label>
            <p className="muted">
              {t(
                "Vous en serez administrateur et pourrez inviter des membres. Les séances personnelles resteront dans votre espace personnel.",
                "You will administer this workspace and can invite members. Personal sessions will remain personal.",
              )}
            </p>
            {moveError && <ErrorBanner message={moveError} />}
            <div className="modal-actions">
              <button className="button primary" disabled={busy}>
                {t("Créer", "Create")}
              </button>
            </div>
          </form>
        </Modal>
      )}
      {workspaceMove && (
        <Modal
          title={t("Changer l’espace de la séance", "Change session workspace")}
          subtitle={workspaceMove.title}
          close={() => {
            if (!busy) setWorkspaceMove(null);
          }}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              setBusy(true);
              setMoveError("");
              void (async () => {
                const latest = await api<SessionResponse>(
                  `/sessions/${workspaceMove.id}`,
                );
                await api(`/sessions/${workspaceMove.id}/workspace`, {
                  method: "PUT",
                  body: JSON.stringify({
                    workspaceId: destinationWorkspace || null,
                    version: latest.session.version,
                  }),
                });
                await refreshDashboard();
                setWorkspaceMove(null);
                setNotice(
                  t(
                    "Espace de la séance modifié.",
                    "Session workspace changed.",
                  ),
                );
              })()
                .catch((e) => setMoveError(e.message))
                .finally(() => setBusy(false));
            }}
          >
            <label>
              {t("Espace de destination", "Destination workspace")}
              <select
                value={destinationWorkspace}
                onChange={(e) => setDestinationWorkspace(e.target.value)}
              >
                <option value="">
                  {t("Séances personnelles", "Personal sessions")}
                </option>
                {workspaces
                  .filter((space) => ["admin", "editor"].includes(space.role))
                  .map((space) => (
                    <option key={space.id} value={space.id}>
                      {space.name}
                    </option>
                  ))}
              </select>
            </label>
            <p className="privacy-explainer">
              {t(
                "Tous les membres de l’espace de destination accéderont à cette séance. Les invitations individuelles et les liens publics existants seront conservés.",
                "Every destination workspace member will gain access to this session. Existing individual invitations and public links will be preserved.",
              )}
            </p>
            {moveError && <ErrorBanner message={moveError} />}
            <div className="modal-actions">
              <button
                className="button primary"
                disabled={
                  busy ||
                  destinationWorkspace === (workspaceMove.workspaceId ?? "")
                }
              >
                {t("Déplacer la séance", "Move session")}
              </button>
            </div>
          </form>
        </Modal>
      )}
      {moving && (
        <Modal
          title={t("Déplacer la séance", "Move session")}
          subtitle={moving.title}
          close={() => {
            if (!mutationId) setMoving(null);
          }}
        >
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              setMutationId(moving.id);
              setMoveError("");
              setNotice("");
              try {
                await updateSession(moving.id, { folder: folderPath(moveTo) });
                setNotice(
                  folderPath(moveTo)
                    ? t(
                        `Séance déplacée dans « ${folderPath(moveTo)} ».`,
                        `Session moved to “${folderPath(moveTo)}”.`,
                      )
                    : t(
                        "Séance déplacée dans « Sans dossier ».",
                        "Session moved to Unfiled.",
                      ),
                );
                setMoving(null);
              } catch (e) {
                setMoveError(mutationMessage(e));
              } finally {
                setMutationId("");
              }
            }}
          >
            <label>
              {t("Dossier de destination", "Destination folder")}
              <input
                value={moveTo}
                onChange={(event) => setMoveTo(event.target.value)}
                list="dashboard-folder-options"
                maxLength={240}
                autoFocus
                placeholder={t(
                  "Ex. Équipe / Ateliers",
                  "e.g. Team / Workshops",
                )}
              />
              <small>
                {t(
                  "Choisissez un dossier existant ou saisissez un chemin avec / pour créer des sous-dossiers. Laissez vide pour retirer le classement.",
                  "Choose an existing folder or enter a path with / to create subfolders. Leave empty to unfile the session.",
                )}
              </small>
            </label>
            <p className="muted">
              {t(
                "Le classement est partagé avec l’équipe de cette séance. Les dossiers restent conservés lorsqu’ils sont vides.",
                "Filing is shared with this session’s team. Folders are retained when empty.",
              )}
            </p>
            {moveError && <ErrorBanner message={moveError} />}
            <div className="modal-actions">
              <button
                type="button"
                className="button secondary"
                disabled={Boolean(mutationId)}
                onClick={() => setMoving(null)}
              >
                {t("Annuler", "Cancel")}
              </button>
              <button className="button primary" disabled={Boolean(mutationId)}>
                <FolderInput size={16} />
                {t("Déplacer", "Move")}
              </button>
            </div>
          </form>
        </Modal>
      )}
      {create && (
        <Modal
          title={t("Une nouvelle séance", "A new session")}
          subtitle={t(
            "Donnez-lui un nom. Le reste prendra forme ensemble.",
            "Give it a name. The rest will come together.",
          )}
          close={() => {
            if (!busy) setCreate(false);
          }}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const values = new FormData(e.currentTarget);
              void newSession(
                String(values.get("title")),
                false,
                String(values.get("folder") ?? ""),
              );
            }}
          >
            <p className="muted">
              {t("Espace de destination : ", "Destination workspace: ")}
              <strong>
                {selectedWorkspace?.name ?? t("Personnel", "Personal")}
              </strong>
            </p>
            <label>
              {t("Nom de la séance", "Session name")}
              <input
                name="title"
                required
                maxLength={200}
                autoFocus
                placeholder={t(
                  "Ex. Atelier vision d’équipe",
                  "e.g. Team vision workshop",
                )}
              />
            </label>
            <label>
              {t("Dossier", "Folder")}
              <input
                name="folder"
                defaultValue={folder ?? ""}
                maxLength={240}
                list="dashboard-folder-options"
                placeholder={t("Sans dossier", "Unfiled")}
              />
              <small>
                {t(
                  "Séparez les sous-dossiers par /. Le dossier est créé avec la séance.",
                  "Separate subfolders with /. The folder is created with the session.",
                )}
              </small>
            </label>
            {error && <ErrorBanner message={error} />}
            <div className="modal-actions">
              <button
                type="button"
                className="button secondary"
                onClick={() => setCreate(false)}
                disabled={busy}
              >
                {t("Annuler", "Cancel")}
              </button>
              <button className="button primary" disabled={busy}>
                {t("Créer la séance", "Create session")}
                <ArrowRight size={16} />
              </button>
            </div>
          </form>
        </Modal>
      )}
      {account && (
        <Modal
          title={t("Mon compte & équipe", "Account & team")}
          close={() => setAccount(false)}
        >
          <div className="account-details">
            <Avatar src={user.avatar} name={user.name} />
            <div>
              <strong>{user.name}</strong>
              <p>{user.email}</p>
            </div>
          </div>
          <details className="account-password">
            <summary>
              {t("Changer mon mot de passe", "Change my password")}
            </summary>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const form = e.currentTarget;
                const values = new FormData(form);
                setPasswordError("");
                setPasswordChanged(false);
                if (
                  values.get("newPassword") !== values.get("confirmPassword")
                ) {
                  setPasswordError(
                    t(
                      "Les nouveaux mots de passe ne correspondent pas.",
                      "The new passwords do not match.",
                    ),
                  );
                  return;
                }
                setPasswordBusy(true);
                try {
                  await post("/auth/password", {
                    currentPassword: values.get("currentPassword"),
                    newPassword: values.get("newPassword"),
                  });
                  form.reset();
                  setPasswordChanged(true);
                } catch (error) {
                  setPasswordError((error as Error).message);
                } finally {
                  setPasswordBusy(false);
                }
              }}
            >
              <label>
                {t("Mot de passe actuel", "Current password")}
                <input
                  name="currentPassword"
                  type="password"
                  autoComplete="current-password"
                  required
                  maxLength={200}
                />
              </label>
              <label>
                {t("Nouveau mot de passe", "New password")}
                <input
                  name="newPassword"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={12}
                  maxLength={200}
                />
                <small>
                  {t(
                    "Au moins 12 caractères. Les autres connexions seront déconnectées.",
                    "At least 12 characters. Other signed-in sessions will be signed out.",
                  )}
                </small>
              </label>
              <label>
                {t("Confirmer le nouveau mot de passe", "Confirm new password")}
                <input
                  name="confirmPassword"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={12}
                  maxLength={200}
                />
              </label>
              {passwordError && <ErrorBanner message={passwordError} />}{" "}
              {passwordChanged && (
                <p role="status">
                  {t("Mot de passe modifié.", "Password updated.")}
                </p>
              )}
              <button className="button secondary" disabled={passwordBusy}>
                {t("Enregistrer le nouveau mot de passe", "Save new password")}
              </button>
            </form>
          </details>
          <Suspense fallback={<Loading />}>
            <ProfileSettings user={user} onSaved={refreshUser} />
            <AdminAccounts user={user} />
          </Suspense>
          <p className="muted">
            {t(
              "Invitez un collègue à créer son compte, puis ajoutez-le aux séances de votre choix depuis leur panneau de partage.",
              "Invite a colleague to create an account, then add them to the sessions you choose from their sharing panel.",
            )}
          </p>
          {inviteError && <ErrorBanner message={inviteError} />}
          {user.isAdmin && (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setInviteError("");
                setInviteBusy(true);
                try {
                  const values = Object.fromEntries(
                    new FormData(e.currentTarget),
                  );
                  const r = await post<{ token: string }>(
                    "/auth/invites",
                    values,
                  );
                  setCreatedInvite(`${location.origin}/join/${r.token}`);
                  setInviteCopied(false);
                } catch (e) {
                  setInviteError((e as Error).message);
                } finally {
                  setInviteBusy(false);
                }
              }}
            >
              <label>
                {t("Nom du collègue", "Colleague’s name")}
                <input name="name" required maxLength={100} />
              </label>
              <label>
                {t("Adresse e-mail", "Email address")}
                <input name="email" type="email" required />
              </label>
              <button className="button primary" disabled={inviteBusy}>
                {t("Créer une invitation", "Create invitation")}
              </button>
            </form>
          )}
          {createdInvite && (
            <div className="share-result">
              <p>
                {t(
                  "Transmettez ce lien à votre collègue :",
                  "Send this link to your colleague:",
                )}
              </p>
              <input
                readOnly
                value={createdInvite}
                onFocus={(e) => e.target.select()}
              />
              <button
                className="button secondary"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(createdInvite);
                    setInviteCopied(true);
                  } catch {
                    setInviteError(
                      t(
                        "Sélectionnez le lien pour le copier manuellement.",
                        "Select the link to copy it manually.",
                      ),
                    );
                  }
                }}
              >
                <Copy size={15} />
                {inviteCopied ? t("Copié", "Copied") : t("Copier", "Copy")}
              </button>
            </div>
          )}
          <small className="muted">
            {t(
              "La création de comptes est réservée à l’administrateur de cet espace.",
              "Only the workspace administrator can create invitations.",
            )}
          </small>
        </Modal>
      )}
    </div>
  );
}
