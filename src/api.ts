import type { Locale } from "../shared/model";
import { recordServerTime } from "./clock";

const messages: Record<string, [string, string]> = {
  AI_CONTEXT_LIMIT: [
    "Ce périmètre dépasse 200 séances. Choisissez des séances précises pour limiter le contexte.",
    "This scope exceeds 200 agendas. Select specific sessions to limit context.",
  ],
  AI_EXPORT_INVALID: [
    "L’IA a proposé des réglages ou un plan invalides. Précisez la demande puis réessayez.",
    "AI proposed invalid settings or an outline. Refine your request and retry.",
  ],
  EXPORT_PRESET_LIMIT: [
    "Supprimez un préréglage avant d’en créer un autre (20 maximum).",
    "Delete a preset before creating another (up to 20).",
  ],
  EMPTY_SHARE: [
    "Choisissez au moins un jour, une page publique ou un formulaire publié.",
    "Choose at least one day, public page, or published form.",
  ],
  FOLDER_CONFLICT: [
    "Les dossiers ont changé. La liste a été actualisée ; vérifiez puis réessayez.",
    "Folders changed. The list was refreshed; review it and try again.",
  ],
  FOLDER_EXISTS: [
    "Un dossier porte déjà ce nom à cet emplacement. Choisissez une autre destination.",
    "A folder already has this name at that location. Choose another destination.",
  ],
  FOLDER_NOT_EMPTY: [
    "Déplacez les séances de ce dossier et de ses sous-dossiers, y compris les archives, avant de le supprimer.",
    "Move sessions out of this folder and its subfolders, including archived sessions, before deleting it.",
  ],
  FOLDER_SELF: [
    "Le dossier ne peut pas être déplacé à l’intérieur de lui-même.",
    "A folder cannot be moved inside itself.",
  ],
  INVALID_ASSIGNEE: [
    "Cette personne ne peut pas être attribuée à cette séance. Actualisez les collaborateurs.",
    "This person cannot be assigned to this session. Refresh the collaborators.",
  ],
  ACCOUNT_INVITE_FORBIDDEN: [
    "Un administrateur global ou de cet espace doit inviter les nouveaux comptes. Vous pouvez ajouter un compte existant.",
    "A global or workspace administrator must invite new accounts. You can add an existing account.",
  ],
  ACCOUNT_UNAVAILABLE: [
    "Ce compte est désactivé ou indisponible. Contactez un administrateur.",
    "This account is disabled or unavailable. Contact an administrator.",
  ],
  IMPORT_FILE_LIMIT: [
    "Le fichier dépasse la limite de 5 Mo.",
    "The file exceeds the 5 MB limit.",
  ],
  IMPORT_FILE_INVALID: [
    "Ce document est invalide, endommagé ou protégé. Exportez-le de nouveau et réessayez.",
    "This document is invalid, damaged or protected. Export it again and retry.",
  ],
  IMPORT_ARCHIVE_LIMIT: [
    "Le document décompressé dépasse les limites autorisées. Réduisez sa taille.",
    "The expanded document exceeds processing limits. Reduce its size.",
  ],
  IMPORT_XML_UNSAFE: [
    "Ce document contient des déclarations XML non autorisées. Exportez-le de nouveau.",
    "This document contains unsupported XML declarations. Export it again.",
  ],
  IMPORT_XML_LIMIT: [
    "Le document contient une structure XML trop complexe.",
    "The document contains an overly complex XML structure.",
  ],
  IMPORT_TEXT_LIMIT: [
    "Le texte extrait dépasse 200 000 caractères ou une cellule dépasse 30 000 caractères.",
    "Extracted text exceeds 200,000 characters or one cell exceeds 30,000 characters.",
  ],
  IMPORT_TABLE_LIMIT: [
    "Le tableau dépasse 1 000 lignes de données, 40 colonnes ou 30 feuilles.",
    "The table exceeds 1,000 data rows, 40 columns or 30 sheets.",
  ],
  IMPORT_PAGE_LIMIT: [
    "Le document dépasse 100 pages PDF ou 500 diapositives.",
    "The document exceeds 100 PDF pages or 500 slides.",
  ],
  IMPORT_ENCODING: [
    "Enregistrez le fichier texte en UTF-8 puis réessayez.",
    "Save the text file as UTF-8 and retry.",
  ],
  IMPORT_FORMAT_UNSUPPORTED: [
    "Ce format n’est pas pris en charge. Utilisez DOCX, PPTX, XLSX, PDF, CSV, TXT, Markdown, PNG ou JPEG.",
    "This format is unsupported. Use DOCX, PPTX, XLSX, PDF, CSV, TXT, Markdown, PNG or JPEG.",
  ],
  IMPORT_EMPTY: ["Le fichier est vide.", "The file is empty."],
  IMPORT_TIMEOUT: [
    "Le traitement a dépassé 15 secondes. Réduisez le document avant de réessayer.",
    "Processing exceeded 15 seconds. Reduce the document before retrying.",
  ],
  IMPORT_BUSY: [
    "Deux documents sont déjà en cours de traitement. Réessayez dans un instant.",
    "Two documents are already being processed. Retry shortly.",
  ],
  AI_VISION_DISABLED: [
    "L’OCR nécessite un modèle de vision interne configuré par l’administrateur.",
    "OCR requires an internal vision model configured by the administrator.",
  ],
  AI_IMPORT_INVALID: [
    "L’IA n’a pas renvoyé un agenda valide. Précisez les consignes puis réessayez.",
    "AI did not return a valid agenda. Refine the instructions and retry.",
  ],
  AI_PROPOSAL_INVALID: [
    "La proposition IA contient une modification invalide. Précisez votre demande et réessayez.",
    "The AI proposal contains an invalid change. Refine your request and retry.",
  ],
  AI_PROPOSAL_DECIDED: [
    "Cette proposition a déjà été acceptée ou rejetée. Rechargez la conversation.",
    "This proposal has already been accepted or rejected. Reload the conversation.",
  ],
  AI_CONVERSATION_LIMIT: [
    "La limite de conversations est atteinte. Supprimez les anciennes conversations.",
    "The conversation limit has been reached. Delete older conversations.",
  ],
  AI_MESSAGE_LIMIT: [
    "Cette conversation a atteint sa limite. Créez une nouvelle conversation.",
    "This conversation has reached its limit. Create a new conversation.",
  ],
  AI_RESPONSE_CONTEXT_LIMIT: [
    "Les réponses sont trop volumineuses pour cette synthèse.",
    "The responses are too large for this summary.",
  ],
  FORM_NO_RESPONSES: [
    "Ce formulaire n’a pas encore de réponses.",
    "This form has no responses yet.",
  ],
  SESSION_CLOSED: [
    "Cette séance est clôturée. Son propriétaire ou un administrateur doit la rouvrir avant toute modification.",
    "This session is closed. Its owner or an administrator must reopen it before changes can be made.",
  ],
  SESSION_OPEN: [
    "Cette séance est déjà ouverte. Rechargez la page.",
    "This session is already open. Reload the page.",
  ],
  ACTIVE_RUN: [
    "Arrêtez le minuteur avant de clôturer ou supprimer cette séance.",
    "Stop the timer before closing or deleting this session.",
  ],
  INVALID_FACILITATOR: [
    "Choisissez les animateurs parmi les collaborateurs actuels de la séance.",
    "Choose facilitators among the session’s current collaborators.",
  ],
  TRASH_EXPIRED: [
    "Le délai de récupération de cette séance est terminé, ou elle a déjà été restaurée.",
    "This session’s recovery period has ended, or it was already restored.",
  ],
  SAME_SESSION: [
    "Utilisez les commandes des jours pour déplacer des blocs dans la même séance.",
    "Use the day controls to move blocks within the same session.",
  ],
  LAST_DAY: [
    "Conservez au moins un jour dans la séance source.",
    "Keep at least one day in the source session.",
  ],
  IMPORT_LIMIT: [
    "Ce transfert dépasserait les limites de la séance. Réduisez la sélection ou créez une nouvelle séance.",
    "This transfer would exceed the session limits. Reduce the selection or create a new session.",
  ],
  OIDC_UNAVAILABLE: [
    "Le fournisseur d’identité est indisponible. Réessayez ou utilisez votre compte local.",
    "The identity provider is unavailable. Retry or use your local account.",
  ],
  LAST_WORKSPACE_ADMIN: [
    "Conservez au moins un administrateur actif dans cet espace. Pour supprimer votre compte, indiquez un destinataire du transfert.",
    "Keep at least one active workspace administrator. To delete your account, choose a transfer recipient.",
  ],
  WORKSPACE_NOT_EMPTY: [
    "Déplacez les séances de cet espace avant de le supprimer.",
    "Move the workspace’s sessions before deleting it.",
  ],
  OWNED_SESSIONS: [
    "Cette personne possède des séances dans cet espace. Déplacez-les ou transférez leur propriété avant de retirer ses accès.",
    "This person owns sessions in this workspace. Move them or transfer ownership before removing access.",
  ],
  MEMBER_EXISTS: [
    "Ce compte appartient déjà à l’espace. Modifiez son rôle dans la liste.",
    "This account already belongs to the workspace. Change its role in the list.",
  ],
  SELF_ADMIN_PROTECTED: [
    "Un autre administrateur doit modifier vos droits d’administration.",
    "Another administrator must change your administrator access.",
  ],
  ACCOUNT_CHANGED: [
    "Votre compte a changé. Rechargez la page avant de réessayer.",
    "Your account changed. Reload before trying again.",
  ],
  LAST_ADMIN: [
    "Nommez un autre administrateur actif avant de supprimer votre compte.",
    "Appoint another active administrator before deleting your account.",
  ],
  TRANSFER_REQUIRED: [
    "Indiquez l’adresse d’un compte actif auquel transférer vos séances.",
    "Enter the email of an active account to receive your sessions.",
  ],
  RESET_INVALID: [
    "Ce lien de récupération a expiré ou a déjà été utilisé.",
    "This recovery link has expired or has already been used.",
  ],
  COMMENTS_DISABLED: [
    "Les commentaires sont désactivés pour ce lien.",
    "Comments are disabled for this link.",
  ],
  INVALID_COMMENT: [
    "Cet échange n’est pas accessible depuis ce lien.",
    "This discussion is not available through this link.",
  ],
  INVALID_PAGE: [
    "Seules les Pages marquées publiques peuvent être partagées.",
    "Only Pages marked public can be shared.",
  ],
  INVALID_MENTION: [
    "Seuls les collaborateurs actuels de cette séance peuvent être mentionnés.",
    "Only current session collaborators can be mentioned.",
  ],
  THREAD_RESOLVED: [
    "Cette discussion est résolue. Rouvrez-la avant de répondre. Votre texte est conservé.",
    "This thread is resolved. Reopen it before replying. Your text is preserved.",
  ],
  THREAD_CONFLICT: [
    "La discussion a changé. Actualisez-la avant de la résoudre.",
    "This thread changed. Refresh before resolving it.",
  ],
  COMMENT_LIMIT: [
    "Cette discussion a atteint sa limite. Créez une nouvelle discussion.",
    "This conversation reached its limit. Start a new thread.",
  ],
  VISITOR_COMMENT_LIMIT: [
    "Ce lien n’accepte plus de commentaires.",
    "This link is no longer accepting comments.",
  ],
  FORM_FULL: [
    "Ce formulaire n’accepte plus de réponses.",
    "This form is no longer accepting responses.",
  ],
  FORM_EMPTY: [
    "Ajoutez au moins une question avant de publier le formulaire.",
    "Add at least one question before publishing the form.",
  ],
  FORM_CHANGED: [
    "Le formulaire a changé. Rechargez sa dernière version avant de répondre.",
    "This form changed. Reload its latest version before answering.",
  ],
  FORM_ANSWERS_INVALID: [
    "Certaines réponses sont manquantes ou invalides.",
    "Some answers are missing or invalid.",
  ],
  FORM_SUBMISSION_CONFLICT: [
    "Cet envoi a déjà été enregistré avec un contenu différent.",
    "This submission was already recorded with different content.",
  ],
  COLLABORATION_BUSY: [
    "L’agenda change rapidement dans une autre fenêtre. Votre brouillon est conservé ; réessayez l’enregistrement dans un instant.",
    "The agenda is changing quickly in another window. Your draft is preserved; retry saving in a moment.",
  ],
  INVALID_PLANNED_START: [
    "L’heure prévue doit être passée et exister dans le fuseau horaire de l’agenda. Vérifiez sa date et son horaire.",
    "The scheduled time must be in the past and exist in the agenda timezone. Check its date and time.",
  ],
  NETWORK_ERROR: [
    "Connexion impossible. Vos modifications locales sont conservées. Réessayez lorsque la connexion revient.",
    "Connection failed. Your local changes are preserved. Retry when the connection returns.",
  ],
  INVALID_RESPONSE: [
    "Le serveur a renvoyé une réponse inattendue. Réessayez.",
    "The server returned an unexpected response. Please retry.",
  ],
  DRAFT_INVALID: [
    "Le brouillon est conservé. Complétez les titres et les champs obligatoires pour l’enregistrer.",
    "Your draft is preserved. Complete titles and required fields to save it.",
  ],
  DRAFT_CHANGED: [
    "Vous avez modifié le brouillon pendant le chargement. Vos modifications sont conservées ; réessayez une fois la saisie terminée.",
    "You edited the draft while it was loading. Your changes are preserved; retry after you finish editing.",
  ],
  RATE_LIMITED: [
    "Trop de demandes. Patientez un instant avant de réessayer.",
    "Too many requests. Please wait a moment before retrying.",
  ],
  ORIGIN_REJECTED: [
    "Cette adresse n’est pas autorisée pour modifier l’agenda. Vérifiez l’URL de l’application.",
    "This address is not allowed to update the agenda. Check the application URL.",
  ],
  JSON_REQUIRED: [
    "La demande n’a pas le format attendu.",
    "The request has an unexpected format.",
  ],
  UNAUTHENTICATED: [
    "Votre connexion a expiré. Reconnectez-vous.",
    "Your session expired. Please sign in again.",
  ],
  FORBIDDEN: [
    "Votre rôle ne permet pas cette action.",
    "Your role does not permit this action.",
  ],
  NOT_FOUND: [
    "Cet élément est introuvable ou vous n’y avez plus accès.",
    "This item was not found or you no longer have access.",
  ],
  BOOTSTRAP_TOKEN_REQUIRED: [
    "La clé d’installation est incorrecte.",
    "The installation key is incorrect.",
  ],
  ALREADY_INITIALIZED: [
    "Un compte administrateur existe déjà. Connectez-vous.",
    "An administrator account already exists. Please sign in.",
  ],
  INVALID_CREDENTIALS: [
    "L’adresse e-mail ou le mot de passe est incorrect.",
    "Email or password is incorrect.",
  ],
  SIGNUP_DISABLED: [
    "Les comptes sont créés sur invitation dans cette installation.",
    "Accounts are created by invitation on this installation.",
  ],
  SIGNUP_DOMAIN: [
    "Cette adresse e-mail ne peut pas créer de compte ici. Utilisez l’adresse de votre organisation.",
    "This email address cannot create an account here. Use your organization's address.",
  ],
  SETUP_REQUIRED: [
    "L’installation n’a pas encore d’administrateur.",
    "The installation has no administrator yet.",
  ],
  ACCOUNT_EXISTS: [
    "Un compte existe déjà pour cette adresse e-mail.",
    "An account already exists for this email.",
  ],
  INVITE_INVALID: [
    "Cette invitation a expiré ou a déjà été utilisée.",
    "This invitation expired or has already been used.",
  ],
  VERSION_CONFLICT: [
    "L’agenda a changé dans une autre fenêtre. Votre brouillon est conservé ; chargez la dernière version avant de poursuivre.",
    "The agenda changed in another window. Your draft is preserved; load the latest version before continuing.",
  ],
  RUN_CONFLICT: [
    "Le minuteur a changé dans une autre fenêtre. Attendez sa mise à jour puis réessayez.",
    "The timer changed in another window. Wait for it to refresh, then retry.",
  ],
  ACTIVE_BLOCK_REMOVED: [
    "Arrêtez ou réinitialisez le minuteur avant de supprimer son bloc actif.",
    "Stop or reset the timer before deleting its active block.",
  ],
  INVALID_DAY: [
    "Ce jour n’existe plus dans l’agenda.",
    "This day no longer exists in the agenda.",
  ],
  INVALID_BLOCK: [
    "Ce bloc n’existe plus dans le jour sélectionné.",
    "This block no longer exists in the selected day.",
  ],
  INVALID_RUN_TRANSITION: [
    "Cette action n’est pas possible dans l’état actuel du minuteur.",
    "This action cannot be applied to the current timer state.",
  ],
  INVALID_EXPIRY: [
    "Choisissez une date d’expiration dans le futur.",
    "Choose an expiration date in the future.",
  ],
  ACCOUNT_NOT_FOUND: [
    "Cette personne doit d’abord accepter une invitation à créer son compte.",
    "This person must accept an account invitation first.",
  ],
  OWNER_IMMUTABLE: [
    "Le rôle du propriétaire ne peut pas être modifié.",
    "The owner role cannot be changed.",
  ],
  VALIDATION_ERROR: [
    "Certains champs sont invalides. Vérifiez les titres, durées et valeurs saisies.",
    "Some fields are invalid. Check titles, durations and entered values.",
  ],
  INVALID_JSON: [
    "La demande contient des données invalides.",
    "The request contains invalid data.",
  ],
  BODY_TOO_LARGE: [
    "L’agenda ou le contenu envoyé est trop volumineux.",
    "The agenda or submitted content is too large.",
  ],
  INTERNAL_ERROR: [
    "Le serveur n’a pas pu terminer la demande. Réessayez.",
    "The server could not complete the request. Please retry.",
  ],
  AI_DISABLED: [
    "Le service d’IA interne n’est pas configuré.",
    "The internal AI service is not configured.",
  ],
  AI_CONFIG: [
    "La configuration du service d’IA interne est incorrecte.",
    "The internal AI service configuration is invalid.",
  ],
  AI_UNAVAILABLE: [
    "Le service d’IA interne est indisponible. Réessayez plus tard.",
    "The internal AI service is unavailable. Please retry later.",
  ],
  AI_RESPONSE_LIMIT: [
    "La réponse de l’IA est trop volumineuse. Simplifiez votre demande.",
    "The AI response is too large. Please simplify your request.",
  ],
  AI_TIMEOUT: [
    "Le service d’IA n’a pas répondu à temps. Réessayez.",
    "The AI service did not respond in time. Please retry.",
  ],
  AI_RESPONSE_TRUNCATED: [
    "L’IA n’a pas eu la place de terminer sa réponse. Réessayez avec une demande plus courte, ou demandez à l’administrateur d’augmenter LLM_MAX_TOKENS.",
    "The AI ran out of room before answering. Retry with a shorter request, or ask the administrator to raise LLM_MAX_TOKENS.",
  ],
  AI_RESPONSE_INVALID: [
    "La réponse de l’IA est inutilisable. Réessayez.",
    "The AI response could not be used. Please retry.",
  ],
  AI_DURATION_INVALID: [
    "La durée de l’agenda proposé ne correspond pas à votre demande. Réessayez.",
    "The generated agenda does not match the requested duration. Please retry.",
  ],
  AI_AGENDA_INVALID: [
    "L’IA a proposé un agenda invalide. Réessayez.",
    "The AI proposed an invalid agenda. Please retry.",
  ],
};

function currentLocale(): Locale {
  try {
    return localStorage.getItem("meetloom.locale") === "en" ? "en" : "fr";
  } catch {
    return "fr";
  }
}
export function apiMessage(
  code: string,
  fallback = "",
  locale = currentLocale(),
): string {
  if (messages[code]) return messages[code][locale === "fr" ? 0 : 1];
  if (
    fallback &&
    fallback.length <= 400 &&
    !/\n\s*at\s|Traceback|<\/?(?:html|script|body)\b/i.test(fallback)
  )
    return fallback;
  return messages.INTERNAL_ERROR[locale === "fr" ? 0 : 1];
}
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code = "",
  ) {
    super(apiMessage(code, message));
    this.name = "ApiError";
  }
}
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (!headers.has("Content-Type"))
    headers.set("Content-Type", "application/json");
  const method = (init?.method ?? "GET").toUpperCase();
  const body =
    init?.body ??
    (["POST", "PUT", "PATCH", "DELETE"].includes(method) ? "{}" : undefined);
  let response: Response;
  const sentAt = Date.now();
  try {
    response = await fetch(`/api${path}`, {
      credentials: "same-origin",
      cache: "no-store",
      ...init,
      headers,
      body,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw error;
    throw new ApiError(0, "", "NETWORK_ERROR");
  }
  recordServerTime(response, sentAt);
  if (response.status === 204) return undefined as T;
  const data = await response.json().catch(() => null);
  if (!response.ok)
    throw new ApiError(
      response.status,
      typeof data?.error === "string" ? data.error : `HTTP ${response.status}`,
      typeof data?.code === "string" ? data.code : "",
    );
  if (data === null) throw new ApiError(502, "", "INVALID_RESPONSE");
  return data as T;
}
export const post = <T>(path: string, body?: unknown) =>
  api<T>(path, { method: "POST", body: JSON.stringify(body ?? {}) });
export function download(
  name: string,
  content: string,
  type = "application/json",
) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
