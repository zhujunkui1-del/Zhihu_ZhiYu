-- AlterTable
ALTER TABLE "Persona" ADD COLUMN     "city" TEXT,
ADD COLUMN     "province" TEXT;

-- CreateIndex
CREATE INDEX "Persona_province_idx" ON "Persona"("province");

-- CreateIndex
CREATE INDEX "Persona_city_idx" ON "Persona"("city");
