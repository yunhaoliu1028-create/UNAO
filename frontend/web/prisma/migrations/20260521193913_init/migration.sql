-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "SavedInvoice" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "status" TEXT NOT NULL DEFAULT 'Completed',
    "invoiceNo" TEXT NOT NULL DEFAULT 'INV-DRAFT-001',
    "roNo" TEXT NOT NULL DEFAULT '',
    "vin" TEXT NOT NULL DEFAULT '',
    "yearMakeModel" TEXT NOT NULL DEFAULT '',
    "insuranceCompany" TEXT NOT NULL DEFAULT '',
    "repairDate" TEXT NOT NULL DEFAULT '',
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "notes" TEXT NOT NULL DEFAULT '',
    "shopName" TEXT NOT NULL DEFAULT '',
    "shopAddress" TEXT NOT NULL DEFAULT '',
    "rawText" TEXT NOT NULL DEFAULT '',
    "operations" TEXT NOT NULL DEFAULT '[]',
    "selectedOperations" TEXT NOT NULL DEFAULT '[]',
    "linesJson" TEXT NOT NULL DEFAULT '[]',
    "total" REAL NOT NULL DEFAULT 0,
    "orgId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SavedInvoice_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MaterialRule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "location" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "make" TEXT,
    "model" TEXT,
    "yearFrom" INTEGER,
    "yearTo" INTEGER,
    "bodyMaterial" TEXT,
    "productPartNo" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "qty" REAL NOT NULL,
    "unit" TEXT NOT NULL,
    "unitPrice" REAL NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'csv_seed',
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "lastUsedAt" DATETIME,
    "negativeCount" INTEGER NOT NULL DEFAULT 0,
    "learnedFromInvoiceId" TEXT,
    "orgId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MaterialRule_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ClaimOutcome" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "invoiceId" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "insurer" TEXT NOT NULL,
    "drpStatus" TEXT NOT NULL DEFAULT 'Non-DRP',
    "region" TEXT,
    "lineDescription" TEXT NOT NULL,
    "lineAmount" REAL NOT NULL,
    "outcome" TEXT NOT NULL,
    "partialAmount" REAL,
    "denialReason" TEXT,
    "orgId" TEXT,
    "recordedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ClaimOutcome_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CustomLogicTemplate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "estimateKeywords" TEXT NOT NULL DEFAULT '[]',
    "operationKeywords" TEXT NOT NULL DEFAULT '[]',
    "linesJson" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "SavedInvoice_orgId_idx" ON "SavedInvoice"("orgId");

-- CreateIndex
CREATE INDEX "SavedInvoice_status_idx" ON "SavedInvoice"("status");

-- CreateIndex
CREATE INDEX "MaterialRule_location_operation_idx" ON "MaterialRule"("location", "operation");

-- CreateIndex
CREATE INDEX "MaterialRule_make_model_idx" ON "MaterialRule"("make", "model");

-- CreateIndex
CREATE INDEX "MaterialRule_orgId_idx" ON "MaterialRule"("orgId");

-- CreateIndex
CREATE INDEX "MaterialRule_source_idx" ON "MaterialRule"("source");

-- CreateIndex
CREATE INDEX "ClaimOutcome_orgId_idx" ON "ClaimOutcome"("orgId");

-- CreateIndex
CREATE INDEX "ClaimOutcome_operation_insurer_idx" ON "ClaimOutcome"("operation", "insurer");
