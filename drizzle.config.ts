import { defineConfig } from "drizzle-kit";

export default defineConfig({
	dialect: "postgresql",
	schema: "./src/storage/postgres/schema.ts",
	out: "./drizzle",
});
