-- CreateEnum
CREATE TYPE "session_scope" AS ENUM ('customer', 'admin');

-- AlterTable
ALTER TABLE "session" ADD COLUMN     "scope" "session_scope" NOT NULL DEFAULT 'customer';
