 # Bitespeed Identity Reconciliation

This is my submission for the Bitespeed backend task.

## What it does

The problem is: a customer might shop online using different emails or phone numbers each time. This service figures out when two different sets of contact info belong to the same person and links them together.

For example, if someone orders with `doc@gmail.com` and `777777`, and later orders with `marty@gmail.com` and the same number, the service recognizes it's the same person and merges their records.

## Tech stack

- Node.js + TypeScript
- Express.js
- PostgreSQL (Supabase)
- pg (node-postgres)

## Challenges I faced

Honestly the hardest part was just understanding the task at first. The "primary turning into secondary" case took me a while to wrap my head around — basically when two separate contacts in the database turn out to be the same person, the older one becomes the primary and the newer one gets demoted to secondary. And then all the secondaries that were pointing to the demoted one have to be re-linked too.

TypeScript was also fairly new to me and threw some errors around types that I had to work through. Replacing all the `any`s with a proper `Contact` interface was something I cleaned up later.

The other thing I didn't initially think about was race conditions — if two requests come in at the exact same time for the same contact, they could conflict in the database. I handled this using serializable transactions, and added retry logic so that if PostgreSQL throws a serialization conflict, the server retries up to 3 times instead of just returning a 500.

Input validation was something I added on top of the base requirements, felt like the right thing to do for a real world API.

Overall I really enjoyed building this. I like solving problems that actually come up in the real world.

## Running locally

Clone the repo first, then:

install dependencies
```
npm install
```

add a `.env` file in the root
```
DATABASE_URL=your_postgres_connection_string
PORT=3000
```

start the server
```
npm run dev
```

server starts at http://localhost:3000

## The endpoint

POST /identify

send this:
```json
{
  "email": "someone@gmail.com",
  "phoneNumber": "9876543210"
}
```

get back this:
```json
{
  "contact": {
    "primaryContatctId": 1,
    "emails": ["someone@gmail.com", "someoneelse@gmail.com"],
    "phoneNumbers": ["9876543210"],
    "secondaryContactIds": [2]
  }
}
```

## Validation I added

- if you send neither email nor phone it returns a 400 error
- at least one of email or phoneNumber must be present

## Live link

