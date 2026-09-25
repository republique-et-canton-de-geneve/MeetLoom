import { lazy, Suspense, useState, type MouseEvent } from "react";
import {
  Activity,
  ArrowLeft,
  DatabaseBackup,
  Inbox,
  KeyRound,
  LogOut,
  MessageSquareWarning,
  ScrollText,
  Settings,
  UserRound,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { User } from "../shared/model";
import { post } from "./api";
import { useI18n } from "./i18n";
import { Avatar, Brand, ErrorBanner, LanguageSwitch, Loading } from "./ui";
import AppVersion from "./AppVersion";
import InviteColleague from "./InviteColleague";
import "./account.css";

const ProfileSettings = lazy(() => import("./ProfileSettings"));
const AdminAccounts = lazy(() => import("./AdminAccounts"));
const AdminActivity = lazy(() => import("./AdminActivity"));
const AdminData = lazy(() => import("./AdminData"));
const AdminSettings = lazy(() => import("./AdminSettings"));
const AdminAnnouncement = lazy(() => import("./AdminAnnouncement"));
const AdminFeedback = lazy(() => import("./AdminFeedback"));
const AdminLogs = lazy(() => import("./AdminLogs"));
const FeedbackForm = lazy(() => import("./FeedbackForm"));

interface Section {
  id: string;
  icon: LucideIcon;
  label: [fr: string, en: string];
  admin?: boolean;
}
export const ACCOUNT_SECTIONS: Section[] = [
  { id: "profile", icon: UserRound, label: ["Profil", "Profile"] },
  { id: "security", icon: KeyRound, label: ["Mot de passe", "Password"] },
  {
    id: "feedback",
    icon: MessageSquareWarning,
    label: ["Signaler un problème", "Report a problem"],
  },
  {
    id: "activity",
    icon: Activity,
    label: ["Activité en cours", "Current activity"],
    admin: true,
  },
  {
    id: "accounts",
    icon: Users,
    label: ["Comptes et invitations", "Accounts and invitations"],
    admin: true,
  },
  {
    id: "settings",
    icon: Settings,
    label: ["Paramètres de l’installation", "Installation settings"],
    admin: true,
  },
  {
    id: "data",
    icon: DatabaseBackup,
    label: ["Sauvegardes et données", "Backups and data"],
    admin: true,
  },
  {
    id: "feedback-inbox",
    icon: Inbox,
    label: ["Retours des utilisateurs", "User feedback"],
    admin: true,
  },
  {
    id: "logs",
    icon: ScrollText,
    label: ["Journaux", "Logs"],
    admin: true,
  },
];

/** "Mon compte & équipe" as a page of its own: `/account/<section>`. */
export default function AccountPage({
  user,
  section,
  from,
  navigate,
  refreshUser,
  logout,
}: {
  user: User;
  section?: string;
  /** The page visited before, for problem reports. */
  from?: string;
  navigate: (url: string) => void;
  refreshUser: () => void;
  logout: () => void;
}) {
  const { t } = useI18n();
  const sections = ACCOUNT_SECTIONS.filter(
    (item) => !item.admin || user.isAdmin,
  );
  const current = sections.find((item) => item.id === section) ?? sections[0];
  const follow = (event: MouseEvent<HTMLAnchorElement>, url: string) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button)
      return;
    event.preventDefault();
    navigate(url);
  };
  const link = (item: Section) => (
    <a
      key={item.id}
      href={`/account/${item.id}`}
      className={`nav-item ${item === current ? "active" : ""}`}
      aria-current={item === current ? "page" : undefined}
      onClick={(event) => follow(event, `/account/${item.id}`)}
    >
      <item.icon size={17} />
      {t(...item.label)}
    </a>
  );
  return (
    <div className="account-page">
      <aside className="account-sidebar">
        <Brand />
        <a
          href="/"
          className="account-back"
          onClick={(event) => follow(event, "/")}
        >
          <ArrowLeft size={16} />
          {t("Mes séances", "My sessions")}
        </a>
        <div className="account-identity">
          <Avatar src={user.avatar} name={user.name} />
          <div>
            <strong>{user.name}</strong>
            <small>{user.email}</small>
          </div>
        </div>
        <nav aria-label={t("Mon compte", "My account")}>
          {sections.filter((item) => !item.admin).map(link)}
          {user.isAdmin && (
            <>
              <span className="nav-caption">
                {t("ADMINISTRATION", "ADMINISTRATION")}
              </span>
              {sections.filter((item) => item.admin).map(link)}
            </>
          )}
        </nav>
        <div className="account-sidebar-footer">
          <LanguageSwitch />
          <button className="button quiet small" onClick={logout}>
            <LogOut size={15} />
            {t("Se déconnecter", "Sign out")}
          </button>
        </div>
      </aside>
      <main className="account-content">
        <h1>{t(...current.label)}</h1>
        <Suspense fallback={<Loading />}>
          {current.id === "profile" && (
            <ProfileSettings user={user} onSaved={refreshUser} />
          )}
          {current.id === "security" && <ChangePassword />}
          {current.id === "activity" && <AdminActivity user={user} />}
          {current.id === "accounts" && (
            <>
              <InviteColleague />
              <AdminAccounts user={user} />
            </>
          )}
          {current.id === "feedback" && <FeedbackForm page={from} />}
          {current.id === "settings" && (
            <>
              <AdminAnnouncement user={user} />
              <AdminSettings user={user} />
            </>
          )}
          {current.id === "data" && <AdminData user={user} />}
          {current.id === "feedback-inbox" && <AdminFeedback user={user} />}
          {current.id === "logs" && <AdminLogs user={user} />}
        </Suspense>
        <AppVersion />
      </main>
    </div>
  );
}

function ChangePassword() {
  const { t } = useI18n();
  const [error, setError] = useState(""),
    [changed, setChanged] = useState(false),
    [busy, setBusy] = useState(false);
  return (
    <section className="account-section account-password">
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const form = e.currentTarget;
          const values = new FormData(form);
          setError("");
          setChanged(false);
          if (values.get("newPassword") !== values.get("confirmPassword")) {
            setError(
              t(
                "Les nouveaux mots de passe ne correspondent pas.",
                "The new passwords do not match.",
              ),
            );
            return;
          }
          setBusy(true);
          try {
            await post("/auth/password", {
              currentPassword: values.get("currentPassword"),
              newPassword: values.get("newPassword"),
            });
            form.reset();
            setChanged(true);
          } catch (error) {
            setError((error as Error).message);
          } finally {
            setBusy(false);
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
        {error && <ErrorBanner message={error} />}
        {changed && (
          <p role="status">{t("Mot de passe modifié.", "Password updated.")}</p>
        )}
        <button className="button secondary" disabled={busy}>
          {t("Enregistrer le nouveau mot de passe", "Save new password")}
        </button>
      </form>
    </section>
  );
}
