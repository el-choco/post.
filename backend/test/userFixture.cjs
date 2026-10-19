async function user(db, workspace) {
  let row = await db.get("SELECT id FROM users WHERE workspace_id=?", [
    workspace,
  ]);
  if (!row) {
    const account = await db.get("SELECT email FROM mail_accounts WHERE id=?", [
      workspace,
    ]);
    const created = await db.run(
      "INSERT INTO users(email,name,password_hash,role,status,workspace_id,created_at) VALUES(?,?,'test-only','user','active',?,?)",
      [account.email, account.email, workspace, Date.now()],
    );
    row = { id: created.lastID };
  }
  return row.id;
}
async function session(db, values) {
  await db.run(
    "INSERT INTO sessions(token_hash,account_id,expires_at,user_id) VALUES(?,?,?,?)",
    [...values, await user(db, values[1])],
  );
}
async function all(db) {
  for (const row of await db.all("SELECT id FROM mail_accounts"))
    await user(db, row.id);
}
module.exports = { session, all, user };
