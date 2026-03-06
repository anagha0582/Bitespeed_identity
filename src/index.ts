import express, { Request, Response } from 'express'
import dotenv from 'dotenv'
import pool from './db'

dotenv.config()

const app = express()
app.use(express.json())

const PORT = process.env.PORT || 3000

app.get('/', (req: Request, res: Response) => {
  res.json({ message: 'Bitespeed Identity Service is running!' })
})

app.post('/identify', async (req: Request, res: Response) => {
  const { email, phoneNumber } = req.body

  // Validate - at least one must be provided
  if (!email && !phoneNumber) {
    return res.status(400).json({ error: 'At least one of email or phoneNumber is required' })
  }

  const client = await pool.connect()

  try {
    // Start a SERIALIZABLE transaction
    // This prevents race conditions by forcing concurrent requests to take turns
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE')

    // Step 1: Find all contacts that match the incoming email or phoneNumber
    const { rows: matchingContacts } = await client.query(
      `SELECT * FROM contacts 
       WHERE "deletedAt" IS NULL
       AND (
         ($1::text IS NOT NULL AND email = $1)
         OR
         ($2::text IS NOT NULL AND "phoneNumber" = $2)
       )`,
      [email || null, phoneNumber ? String(phoneNumber) : null]
    )

    // Step 2: No contacts found - create a brand new primary contact
    if (matchingContacts.length === 0) {
      const { rows } = await client.query(
        `INSERT INTO contacts (email, "phoneNumber", "linkedId", "linkPrecedence", "createdAt", "updatedAt")
         VALUES ($1, $2, NULL, 'primary', NOW(), NOW())
         RETURNING *`,
        [email || null, phoneNumber ? String(phoneNumber) : null]
      )
      const newContact = rows[0]

      await client.query('COMMIT')
      return res.json({
        contact: {
          primaryContatctId: newContact.id,
          emails: newContact.email ? [newContact.email] : [],
          phoneNumbers: newContact.phoneNumber ? [newContact.phoneNumber] : [],
          secondaryContactIds: []
        }
      })
    }

    // Step 3: Find all primary IDs from matching contacts
    const primaryIds = new Set<number>()
    for (const c of matchingContacts) {
      if (c.linkPrecedence === 'primary') primaryIds.add(c.id)
      if (c.linkedId) primaryIds.add(c.linkedId)
    }

    // Step 4: Get ALL contacts under these primaries
    const { rows: allContacts } = await client.query(
      `SELECT * FROM contacts
       WHERE "deletedAt" IS NULL
       AND (
         id = ANY($1)
         OR "linkedId" = ANY($1)
       )`,
      [Array.from(primaryIds)]
    )

    // Step 5: Find the oldest primary - that is the true primary
    const primaries = allContacts.filter((c: any) => c.linkPrecedence === 'primary')
    primaries.sort((a: any, b: any) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    const truePrimary = primaries[0]

    // Step 6: If multiple primaries exist, demote newer ones to secondary
    // This handles the case where two separate clusters get linked together
    for (const p of primaries.slice(1)) {
      await client.query(
        `UPDATE contacts 
         SET "linkPrecedence" = 'secondary', "linkedId" = $1, "updatedAt" = NOW()
         WHERE id = $2`,
        [truePrimary.id, p.id]
      )

      // Also re-link any secondaries that were pointing to the demoted primary
      await client.query(
        `UPDATE contacts
         SET "linkedId" = $1, "updatedAt" = NOW()
         WHERE "linkedId" = $2`,
        [truePrimary.id, p.id]
      )
    }

    // Step 7: Get updated contacts after demotion
    const { rows: finalContacts } = await client.query(
      `SELECT * FROM contacts
       WHERE "deletedAt" IS NULL
       AND (id = $1 OR "linkedId" = $1)`,
      [truePrimary.id]
    )

    // Step 8: Check if incoming request has new info not already in any contact
    const allEmails = finalContacts.map((c: any) => c.email).filter(Boolean)
    const allPhones = finalContacts.map((c: any) => c.phoneNumber).filter(Boolean)

    const isNewEmail = email && !allEmails.includes(email)
    const isNewPhone = phoneNumber && !allPhones.includes(String(phoneNumber))

    // Step 9: Create a new secondary contact if there is new info
    if (isNewEmail || isNewPhone) {
      await client.query(
        `INSERT INTO contacts (email, "phoneNumber", "linkedId", "linkPrecedence", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, 'secondary', NOW(), NOW())`,
        [email || null, phoneNumber ? String(phoneNumber) : null, truePrimary.id]
      )
    }

    // Step 10: Final fetch of all contacts under true primary
    const { rows: resultContacts } = await client.query(
      `SELECT * FROM contacts
       WHERE "deletedAt" IS NULL
       AND (id = $1 OR "linkedId" = $1)
       ORDER BY "createdAt" ASC`,
      [truePrimary.id]
    )

    await client.query('COMMIT')

    // Build response
    const uniqueEmails: string[] = []
    const uniquePhones: string[] = []
    const secondaryIds: number[] = []

    // Primary's email and phone go first
    if (truePrimary.email) uniqueEmails.push(truePrimary.email)
    if (truePrimary.phoneNumber) uniquePhones.push(truePrimary.phoneNumber)

    for (const c of resultContacts) {
      if (c.linkPrecedence === 'secondary') secondaryIds.push(c.id)
      if (c.email && !uniqueEmails.includes(c.email)) uniqueEmails.push(c.email)
      if (c.phoneNumber && !uniquePhones.includes(c.phoneNumber)) uniquePhones.push(c.phoneNumber)
    }

    return res.json({
      contact: {
        primaryContatctId: truePrimary.id,
        emails: uniqueEmails,
        phoneNumbers: uniquePhones,
        secondaryContactIds: secondaryIds
      }
    })

  } catch (err: any) {
    await client.query('ROLLBACK')
    console.error('Error in /identify:', err)
    return res.status(500).json({ error: 'Internal server error' })
  } finally {
    client.release()
  }
})

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`)
})

export default app