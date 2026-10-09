export const demoFolders = [
  {
    path: "INBOX",
    name: "Posteingang",
    specialUse: "\\Inbox",
    unseen: 4,
    total: 12,
  },
  { path: "Sent", name: "Gesendet", specialUse: "\\Sent", unseen: 0, total: 0 },
  {
    path: "Drafts",
    name: "Entwürfe",
    specialUse: "\\Drafts",
    unseen: 0,
    total: 0,
  },
  {
    path: "Archive",
    name: "Archiv",
    specialUse: "\\Archive",
    unseen: 0,
    total: 0,
  },
  { path: "Spam", name: "Spam", specialUse: "\\Junk", unseen: 0, total: 0 },
  {
    path: "Trash",
    name: "Papierkorb",
    specialUse: "\\Trash",
    unseen: 0,
    total: 0,
  },
  { path: "Projekte", name: "Projekte", unseen: 0, total: 0 },
];
for (const [year, months] of [
  ["2025", ["10", "11", "12"]],
  ["2026", Array.from({ length: 9 }, (_, i) => String(i + 1).padStart(2, "0"))],
]) {
  demoFolders.push({
    path: year,
    name: year,
    delimiter: "/",
    selectable: true,
    unseen: 0,
    total: 0,
  });
  for (const month of months)
    demoFolders.push({
      path: year + "/" + month,
      name: month,
      delimiter: "/",
      selectable: true,
      unseen: 0,
      total: 0,
    });
}
const examples = [
  [
    "Mia Weber",
    "Ein guter Start in die Woche",
    "Hallo Alex,\n\nich habe die Ideen für unser neues Projekt zusammengetragen. Ein klarer Fokus, ein bisschen Raum für Neues und ein gutes Team — das klingt nach einem Plan.\n\nLass uns morgen bei einem Kaffee darüber sprechen. Ich freue mich auf deine Gedanken!\n\nLiebe Grüße\nMia",
  ],
  [
    "Studio Nord",
    "Die ersten Entwürfe sind da ✨",
    "Hallo Alex,\n\ndie ersten Entwürfe sind fertig. Wir haben uns auf klare Formen und warme Farben konzentriert. Was hältst du davon?\n\nViele Grüße\nStudio Nord",
  ],
  [
    "Jonas Berger",
    "Kaffee am Donnerstag?",
    "Hallo Alex,\n\nhast du Donnerstag Zeit für einen Kaffee?\n\nJonas",
  ],
  [
    "Design Notes",
    "Kleine Details. Große Wirkung.",
    "Die besten Ideen entstehen oft in den kleinen Momenten. Hier sind unsere Gedanken für diese Woche.",
  ],
  [
    "Lena Fischer",
    "Unser nächstes Abenteuer",
    "Lass uns am Wochenende einen Ausflug planen!",
  ],
  [
    "Team Werkraum",
    "Projektupdate · Oktober",
    "Das Projekt liegt gut im Zeitplan. Nächster Termin: Freitag.",
  ],
  [
    "Paul Richter",
    "Re: Danke für das Gespräch",
    "Vielen Dank für den angenehmen Austausch.",
  ],
  [
    "The Reading Room",
    "Ein Buch für die ruhigen Stunden",
    "Unsere neue Leseempfehlung ist angekommen.",
  ],
  [
    "Nora Klein",
    "Fotos vom Wochenende",
    "Hier die Bilder von unserem Ausflug.",
  ],
  [
    "Open Spaces",
    "Raum für neue Ideen",
    "Unser nächster Workshop findet bald statt.",
  ],
  ["Tim Schulz", "Alles bereit für morgen", "Die Unterlagen liegen bereit."],
  ["Mia Weber", "Bis bald!", "Wir sehen uns nächste Woche."],
];
const demoAttachments = [
  {
    index: 0,
    filename: "Projekt-Notizen.txt",
    contentType: "text/plain;charset=utf-8",
    content: "post. Demo\n\nHier ist Platz für neue Ideen.\n",
  },
  {
    index: 1,
    filename: "Termine.csv",
    contentType: "text/csv;charset=utf-8",
    content: "Termin,Datum\nProjektbesprechung,2026-10-12\n",
  },
].map((attachment) => ({
  ...attachment,
  size: new TextEncoder().encode(attachment.content).length,
}));
export const demoMessages = examples.map(([name, subject, text], i) => ({
  folder: "INBOX",
  uid: i + 1,
  from: {
    name,
    address: `${name.toLowerCase().replace(/[^a-z]/g, "")}@example.com`,
  },
  to: { name: "Alex", address: "alex@post.demo" },
  subject,
  text,
  date: new Date(Date.now() - i * 3600000 * 5).toISOString(),
  size: 2000 + i * 1400,
  seen: i > 3,
  flagged: i === 1,
  attachment: i === 1,
  attachments: i === 1 ? demoAttachments : [],
  html:
    i === 1
      ? `<p>Hallo Alex,</p><p>die ersten Entwürfe sind fertig. Was hältst du davon?</p><p>Viele Grüße<br>Studio Nord</p><blockquote><h3>Weitergeleitete Nachricht</h3>${Array.from({ length: 24 }, (_, index) => `<p>Notiz ${index + 1}: Die Projektunterlagen findest du in den Anhängen. Dies ist eine längere HTML-Nachricht zur Vorschau.</p>`).join("")}</blockquote>`
      : "",
}));
