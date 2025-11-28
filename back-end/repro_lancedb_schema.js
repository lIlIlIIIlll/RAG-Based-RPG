const lancedb = require("@lancedb/lancedb");
const { Field, Float32, Utf8, FixedSizeList, Schema, Float64 } = require("apache-arrow");
const fs = require("fs");
const path = require("path");

async function testSchema() {
  const dbPath = path.join(process.cwd(), "test_db");
  if (fs.existsSync(dbPath)) {
    fs.rmSync(dbPath, { recursive: true, force: true });
  }
  fs.mkdirSync(dbPath);

  const db = await lancedb.connect(dbPath);

  // 1. Create table with old schema
  const oldSchema = new Schema([
    new Field("text", new Utf8()),
    new Field("id", new Utf8()),
  ]);

  const tableName = "test_table";
  await db.createEmptyTable(tableName, oldSchema);
  const table = await db.openTable(tableName);
  
  await table.add([{ text: "hello", id: "1" }]);
  console.log("Inserted record with old schema.");

  // 2. Try to insert record with NEW field (simulating code update)
  try {
    await table.add([{ text: "world", id: "2", createdAt: 12345.0 }]);
    console.log("Inserted record with extra field (createdAt) successfully.");
  } catch (e) {
    console.log("Failed to insert record with extra field:", e.message);
  }

  // 3. Try to open with new schema? (LanceDB openTable doesn't take schema, it reads from disk)
  // So we can't "force" a new schema on open.
  
  // 4. What if we want to migrate?
  // We can read all, drop, and recreate.
  const records = await table.query().toArray();
  console.log("Records:", records);

  // 5. Recreate with new schema
  const newSchema = new Schema([
    new Field("text", new Utf8()),
    new Field("id", new Utf8()),
    new Field("createdAt", new Float64()), // Using Float64 for timestamp
  ]);

  // Drop and recreate
  await db.dropTable(tableName);
  await db.createEmptyTable(tableName, newSchema);
  const newTable = await db.openTable(tableName);

  // Insert old records (missing createdAt)
  // We need to backfill createdAt
  const migratedRecords = records.map(r => ({
    ...r,
    createdAt: Date.now()
  }));

  await newTable.add(migratedRecords);
  console.log("Migrated table successfully.");
  
  const newRecords = await newTable.query().toArray();
  console.log("New Records:", newRecords);
}

testSchema();
