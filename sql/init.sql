 
CREATE TABLE contacts (
  id SERIAL PRIMARY KEY,
  "phoneNumber" TEXT,
  email TEXT,
  "linkedId" INTEGER REFERENCES contacts(id),
  "linkPrecedence" TEXT NOT NULL CHECK ("linkPrecedence" IN ('primary', 'secondary')),
  "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  "deletedAt" TIMESTAMP WITH TIME ZONE
);