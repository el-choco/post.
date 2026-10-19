const express = require("express");
const db = require("./db");
const storage = require("./filesStorage");
const { fail } = require("./calendarNetwork");
async function init() {
  await db.run(
    "CREATE TABLE IF NOT EXISTS file_acl(id INTEGER PRIMARY KEY AUTOINCREMENT,node_id TEXT NOT NULL REFERENCES file_nodes(id) ON DELETE CASCADE,user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,group_id INTEGER REFERENCES user_groups(id) ON DELETE CASCADE,rights INTEGER NOT NULL CHECK(rights IN (1,3,5,7)),CHECK((user_id IS NULL) <> (group_id IS NULL)))",
  );
  await db.run(
    "CREATE UNIQUE INDEX IF NOT EXISTS acl_user ON file_acl(node_id,user_id) WHERE user_id IS NOT NULL",
  );
  await db.run(
    "CREATE UNIQUE INDEX IF NOT EXISTS acl_group ON file_acl(node_id,group_id) WHERE group_id IS NOT NULL",
  );
}
async function actor(accountId) {
  const user = await db.get(
    "SELECT id,permissions FROM users WHERE workspace_id=? AND status='active'",
    [accountId],
  );
  if (!user || JSON.parse(user.permissions).files === false)
    throw fail("multiuser.forbidden", 403);
  return user;
}
async function access(accountId, id, required = 1) {
  const user = await actor(accountId);
  const chain = await db.all(
    "WITH RECURSIVE chain AS (SELECT *,0 depth FROM file_nodes WHERE id=? AND deleted_at IS NULL UNION ALL SELECT n.*,c.depth+1 FROM file_nodes n JOIN chain c ON c.parent_id=n.id WHERE c.depth<100 AND n.account_id=c.account_id) SELECT * FROM chain ORDER BY depth",
    [String(id)],
  );
  if (
    !chain.length ||
    chain.some((n) => n.deleted_at) ||
    chain.at(-1).parent_id
  )
    throw fail("files.errors.notFound", 404);
  const row = chain[0];
  let rights = row.account_id === accountId ? 7 : 0;
  if (!rights) {
    const grants = await db.all(
      `SELECT rights FROM file_acl WHERE node_id IN (${chain.map(() => "?").join(",")}) AND (user_id=? OR group_id IN (SELECT group_id FROM user_group_members WHERE user_id=?))`,
      [...chain.map((n) => n.id), user.id, user.id],
    );
    for (const grant of grants) rights |= grant.rights;
  }
  if ((rights & required) !== required) throw fail("multiuser.forbidden", 403);
  return { row, rights, owner: row.account_id === accountId, userId: user.id };
}
async function items(accountId, options) {
  if (options.trash) throw fail("multiuser.forbidden", 403);
  if (options.parent && options.parent !== "root") {
    const { row, rights, userId } = await access(accountId, options.parent);
    if (!row.folder) throw fail("files.errors.notFolder");
    const result = await storage.list(row.account_id, options);
    const direct = result.items.length
      ? await db.all(
          `SELECT node_id,rights FROM file_acl WHERE node_id IN (${result.items.map(() => "?").join(",")}) AND (user_id=? OR group_id IN (SELECT group_id FROM user_group_members WHERE user_id=?))`,
          [...result.items.map((item) => item.id), userId, userId],
        )
      : [];
    const itemRights = new Map(result.items.map((item) => [item.id, rights]));
    for (const grant of direct)
      itemRights.set(
        grant.node_id,
        itemRights.get(grant.node_id) | grant.rights,
      );
    const breadcrumbs = [];
    let current = row;
    while (current) {
      try {
        await access(accountId, current.id);
      } catch {
        break;
      }
      breadcrumbs.unshift(storage.publicNode(current));
      current = current.parent_id
        ? await db.get("SELECT * FROM file_nodes WHERE id=?", [
            current.parent_id,
          ])
        : null;
    }
    return {
      ...result,
      used: 0,
      breadcrumbs,
      canWrite: !!(rights & 2),
      items: result.items.map((item) => ({
        ...item,
        rights: itemRights.get(item.id),
        readOnly: !(itemRights.get(item.id) & 2),
      })),
    };
  }
  const user = await db.get(
    "SELECT id FROM users WHERE workspace_id=? AND status='active'",
    [accountId],
  );
  if (!user) throw fail("multiuser.forbidden", 403);
  const offset = Number(options.cursor || 0);
  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    String(options.query || "").length > 200
  )
    throw fail("files.errors.input");
  const rows = await db.all(
    "SELECT DISTINCT n.* FROM file_nodes n JOIN file_acl a ON a.node_id=n.id WHERE n.account_id<>? AND n.deleted_at IS NULL AND (a.user_id=? OR a.group_id IN(SELECT group_id FROM user_group_members WHERE user_id=?)) AND instr(lower(n.name),lower(?))>0 ORDER BY n.folder DESC,n.name COLLATE NOCASE",
    [accountId, user.id, user.id, options.query || ""],
  );
  const visible = [];
  for (const row of rows) {
    try {
      const a = await access(accountId, row.id);
      if (!options.folders || row.folder)
        visible.push({
          ...storage.publicNode(row),
          rights: a.rights,
          readOnly: !(a.rights & 2),
        });
    } catch {}
  }
  return {
    items: visible.slice(offset, offset + 200),
    next: visible.length > offset + 200 ? String(offset + 200) : null,
    breadcrumbs: [],
    canWrite: false,
    used: 0,
    quota: storage.limits().quota,
  };
}
function router(auth, wrap) {
  const router = express.Router();
  router.use(["/acl", "/sources/shared"], auth);
  router.get(
    "/acl/:id",
    wrap(async (req, res) => {
      await storage.owned(req.account.id, req.params.id);
      res.json({
        grants: await db.all(
          "SELECT a.*,u.name user_name,g.name group_name FROM file_acl a LEFT JOIN users u ON u.id=a.user_id LEFT JOIN user_groups g ON g.id=a.group_id WHERE node_id=?",
          [req.params.id],
        ),
      });
    }),
  );
  router.put(
    "/acl/:id",
    wrap(async (req, res) => {
      await storage.owned(req.account.id, req.params.id);
      const grants = req.body.grants;
      if (
        !Array.isArray(grants) ||
        grants.length > 200 ||
        grants.some(
          (g) =>
            !["user", "group"].includes(g.type) ||
            !Number.isSafeInteger(g.id) ||
            ![1, 3, 5, 7].includes(g.rights),
        )
      )
        throw fail("multiuser.input");
      await db.transaction(async (run, query) => {
        if (
          !(
            await query(
              "SELECT id FROM file_nodes WHERE id=? AND account_id=? AND deleted_at IS NULL",
              [req.params.id, req.account.id],
            )
          ).length
        )
          throw fail("files.errors.notFound", 404);
        await run("DELETE FROM file_acl WHERE node_id=?", [req.params.id]);
        for (const g of grants) {
          if (
            !(
              await query(
                `SELECT id FROM ${g.type === "user" ? "users" : "user_groups"} WHERE id=?`,
                [g.id],
              )
            ).length
          )
            throw fail("multiuser.input");
          await run(
            "INSERT INTO file_acl(node_id,user_id,group_id,rights) VALUES(?,?,?,?)",
            [
              req.params.id,
              g.type === "user" ? g.id : null,
              g.type === "group" ? g.id : null,
              g.rights,
            ],
          );
        }
      });
      res.json({ success: true });
    }),
  );
  router.get(
    "/sources/shared/items",
    wrap(async (req, res) =>
      res.json(
        await items(req.account.id, {
          parent: String(req.query.parent || "root"),
          query: String(req.query.q || ""),
          cursor: req.query.cursor,
          folders: req.query.folders === "1",
          trash: req.query.trash === "1",
        }),
      ),
    ),
  );
  router.post(
    "/sources/shared/folders",
    wrap(async (req, res) => {
      const { row } = await access(req.account.id, req.body.parentId, 3);
      res.json(await storage.mkdir(row.account_id, row.id, req.body.path));
    }),
  );
  router.patch(
    "/sources/shared/items/:id",
    wrap(async (req, res) => {
      const { row } = await access(
        req.account.id,
        req.params.id,
        req.body.parentId === undefined ? 3 : 7,
      );
      if (req.body.parentId !== undefined) {
        const target = await access(req.account.id, req.body.parentId, 3);
        if (target.row.account_id !== row.account_id)
          throw fail("multiuser.forbidden", 403);
      }
      res.json(await storage.change(row.account_id, row.id, req.body));
    }),
  );
  router.post(
    "/sources/shared/items/:id/trash",
    wrap(async (req, res) => {
      if (req.body.confirm !== true) throw fail("multiuser.input");
      const { row } = await access(req.account.id, req.params.id, 5);
      await storage.remove(row.account_id, row.id);
      res.json({ success: true });
    }),
  );
  router.post(
    "/sources/shared/uploads",
    wrap(async (req, res) => {
      const { row } = await access(req.account.id, req.body.parentId, 3);
      if (!row.folder) throw fail("files.errors.notFolder");
      res.json(
        await storage.begin(req.account.id, "shared", {
          ...req.body,
          parentId: row.id,
        }),
      );
    }),
  );
  return router;
}
module.exports = { init, actor, access, items, router };
