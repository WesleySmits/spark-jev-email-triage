/**
 * The default triage rubric: what each category and priority means, and the
 * thresholds policy applies. It is opinionated and written for any Spark
 * inbox, personal or work. Everything a rubric decides lives here, so a
 * different rubric can later replace it as a whole.
 *
 * Ids are stable English identifiers and never translated. Descriptions are
 * English because the classifier reads them. Display labels belong to UI
 * translations, not here.
 */

export const triageCategories = [
  'personal',
  'notification',
  'security',
  'purchase',
  'newsletter',
  'promotion',
  'suspicious',
  'other',
] as const

export const triagePriorities = ['urgent', 'high', 'normal', 'low'] as const

type Category = (typeof triageCategories)[number]
type Priority = (typeof triagePriorities)[number]

export const defaultRubric = {
  /** Change the id whenever a meaning or threshold changes. */
  id: 'email-triage.v2',
  categories: {
    personal:
      'A person writes to the mailbox owner directly: a friend, colleague, customer, or anyone else who expects a human to read it.',
    notification:
      'An automated message from a service, app, or tool about activity, status, or updates, such as a pull request, a comment, a shared file, or a system alert.',
    security:
      'A genuine account-security message from a service the owner uses: a sign-in alert, a one-time code, a password or key change, or a new device.',
    purchase:
      'An order, receipt, invoice, payment, subscription renewal, refund, or delivery update.',
    newsletter: 'Editorial content the owner subscribed to, sent to a list.',
    promotion:
      'Marketing, offers, or an unsolicited pitch that tries to sell a product or service.',
    suspicious:
      'Phishing, a scam, impersonation, or an illegitimate request for credentials, money, or payment changes.',
    other:
      'None of the categories above clearly fits, or the thread lacks the information to tell.',
  } satisfies Record<Category, string>,
  priorities: {
    urgent:
      'The mailbox owner must act within hours: a security incident, an outage, or a deadline today.',
    high: 'A person needs a response, or an action is due, within a day or two.',
    normal: 'Worth reading or handling at some point, with no time pressure.',
    low: 'Needs no action: notifications, newsletters, promotions, or information only.',
  } satisfies Record<Priority, string>,
  thresholds: {
    /** Minimum probability of the chosen category to accept it without review. */
    autoAccept: 0.8,
    /** Below this confidence, priority is shown as uncertain. It does not force review. */
    priorityConfidence: 0.5,
    /** At or above this probability, a suspicion signal forces elevated review. Low on purpose. */
    suspicionFloor: 0.4,
    /** Yes/no probabilities at or above `likely` read as likely, at or below `unlikely` as unlikely. */
    likely: 0.7,
    unlikely: 0.3,
  },
} as const
