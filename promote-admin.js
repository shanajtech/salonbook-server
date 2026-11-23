import { MongoClient } from 'mongodb';
const mongo = new MongoClient(process.env.MONGODB_URI);
const email = process.argv[2];
if (!email) throw new Error('Supply the email of a dedicated account you created through signup');
try {
  const users = mongo.db(process.env.MONGODB_DATABASE || 'salonbook').collection('user');
  const result = await users.updateOne({ email: email.toLowerCase() }, { $set: { role: 'admin' } });
  if (!result.matchedCount) throw new Error('Account was not found');
  console.log('Admin role assigned. Sign out and back in to refresh the session.');
} finally { await mongo.close(); }

