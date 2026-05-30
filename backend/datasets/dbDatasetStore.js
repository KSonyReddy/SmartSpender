import mongoose from 'mongoose';

export async function readDatasetFromMongo(collectionName) {
  try {
    if (!collectionName) return null;
    if (mongoose.connection.readyState !== 1 || !mongoose.connection.db) return null;

    const docs = await mongoose.connection.db
      .collection(collectionName)
      .find({})
      .project({ _id: 0 })
      .toArray();

    if (!Array.isArray(docs) || docs.length === 0) return null;
    return docs;
  } catch (error) {
    console.warn(`⚠️ Failed reading "${collectionName}" from MongoDB: ${error.message}`);
    return null;
  }
}

export default readDatasetFromMongo;
