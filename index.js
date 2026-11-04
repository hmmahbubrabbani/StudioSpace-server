import express from 'express';
import { MongoClient, ObjectId } from 'mongodb';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import 'dotenv/config';

const app = express();
const PORT = process.env.PORT || 8000;

// MongoDB Connection
const client = new MongoClient(process.env.MONGODB_URI);

export async function connectToMongoDB(){
  try {
    await client.connect();
    console.log("You successfully connected to MongoDB!");
    return client;
  } catch (err){
    console.error("Failed to connect to MongoDB", err);
    process.exit(1);
  }
}

app.use(cors());
app.use(express.json());

// Connect and initialize database & collections
const mongoClient = await connectToMongoDB();
const db = mongoClient.db("StudioSpaceDB");
const studioCollection = db.collection("studios");
const bookingCollection = db.collection("bookings");
const userCollection = db.collection("users"); 


// JWT / TOKEN VERIFICATION PROXY 

const verifyToken = async(req, res, next) =>{
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Unauthorized access. No token provided."});
    }

    const token = authHeader.split(" ")[1];

    if (!token) {
      return res.status(403).json({ error: "Forbidden access. Invalid token."});
    }

    // jwt.decode 
    const decoded = jwt.decode(token);

    if (!decoded) {
      return res.status(403).json({ error: "Invalid or expired token" });
    }
    
    req.user = decoded;
    next();

  } catch (error) {
    console.error("Token verification failed:", error);
    return res.status(403).json({ error: "Invalid or expired token" });
  }
};



// STUDIO API ROUTES


// Add a new studio listing  with verifyToken
app.post("/studios", verifyToken, async (req, res) =>{
  try {
    const data = req.body;
    data.hostEmail = data.hostEmail || req.user?.email;
    data.createdAt = new Date();

    const result = await studioCollection.insertOne(data);
    res.status(201).send(result);
  } catch (error) {
    console.error("Error adding studio:", error);
    res.status(500).json({ error: "Failed to add studio listing"});
  }
});

// Get all studios
app.get('/studios', async (req, res) =>{
  try {
    const { category, hostEmail } = req.query;
    let query = {};
    if (category && category !== "All") query.category = category;
    if (hostEmail) query["host.email"] = hostEmail;

    const result = await studioCollection.find(query).toArray();
    res.send(result);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch studios"});
  }
});

// Get single studio details by ID 
app.get('/studios/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ error: "Invalid Studio ID format" });
    }
    const result = await studioCollection.findOne({ _id: new ObjectId(id) });
    if (!result) {
      return res.status(404).json({ error: "Studio not found" });
    }
    res.send(result);
  } catch (error) {
    res.status(400).json({ error: "Invalid Studio ID format" });
  }
});

// UPDATE / EDIT a studio listingwith verifyToken
app.put('/studios/:id', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ error: "Invalid Studio ID format" });
    }

    const updatedData = { ...req.body };
    delete updatedData._id;

    const result = await studioCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: updatedData }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ error: "Studio not found" });
    }

    res.status(200).json({
      message: "Studio updated successfully",
      result
    });

  } catch (error) {
    console.error("Error updating studio:", error);
    res.status(500).json({ error: "Failed to update studio" });
  }
});

// Delete a studio listing with verifyToken
app.delete('/studios/:id', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ error: "Invalid Studio ID format" });
    }
    const result = await studioCollection.deleteOne({ _id: new ObjectId(id) });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: "Failed to delete studio listing" });
  }
});



// WISHLIST API ROUTES 


// Toggle Wishlist
app.post("/wishlist/toggle", verifyToken, async (req, res) => {
  try {
    const { userEmail, studioId } = req.body;
    const email = userEmail || req.user?.email;

    if (!email || !studioId) {
      return res.status(400).json({ error: "User email and studio ID are required" });
    }


    let user = await userCollection.findOne({ email });

    if (!user) {
     
      await userCollection.insertOne({ email, wishlist: [] });
      user = { email, wishlist: [] };
    }

    const wishlist = user.wishlist || [];
    const index = wishlist.indexOf(studioId);

    if (index > -1) {
     
      wishlist.splice(index, 1);
      await userCollection.updateOne({ email }, { $set: { wishlist } });
      return res.json({ success: true, action: "removed", wishlist });
    } else {
     
      wishlist.push(studioId);
      await userCollection.updateOne({ email }, { $set: { wishlist } });
      return res.json({ success: true, action: "added", wishlist });
    }
  } catch (error) {
    console.error("Wishlist toggle error:", error);
    res.status(500).json({ error: "Failed to update wishlist" });
  }
});


app.get("/wishlist", verifyToken, async (req, res) => {
  try {
    const email = req.query.email || req.user?.email;
    if (!email) {
      return res.status(400).json({ error: "User email is required" });
    }

    const user = await userCollection.findOne({ email });
    if (!user || !user.wishlist || user.wishlist.length === 0) {
      return res.json([]);
    }

    // উইশলিস্টে থাকা স্টুডিও আইডিগুলোর অবজেক্ট আইডি রূপান্তর করে স্টুডিও ফেচ করা
    const studioObjectIds = user.wishlist.map(id => {
      try { return new ObjectId(id); } catch(e) { return null; }
    }).filter(Boolean);

    const studios = await studioCollection.find({ _id: { $in: studioObjectIds } }).toArray();
    res.json(studios);
  } catch (error) {
    console.error("Error fetching wishlist:", error);
    res.status(500).json({ error: "Failed to fetch wishlist" });
  }
});



// BOOKING API ROUTES


// Create a new booking request with Double-Booking Prevention 
app.post("/bookings", verifyToken, async (req, res) => {
  try {
    const { studioId, bookingDate, startTime, hours } = req.body;

    // ১. একই স্টুডিও এবং একই তারিখের সমস্ত বুকিং ফেচ করা (যা অলরেডি কনফার্মড)
    const existingBookings = await bookingCollection.find({
      studioId: studioId,
      bookingDate: bookingDate,
      status: "Confirmed"
    }).toArray();

    // ২. নতুন বুকিংয়ের শুরুর সময় ও শেষের সময় মিনিটে রূপান্তর করা
    const [newStartHour, newStartMinute] = startTime.split(":").map(Number);
    const newStartTotalMinutes = newStartHour * 60 + newStartMinute;
    const newEndTotalMinutes = newStartTotalMinutes + Number(hours) * 60;

    // ৩. ওভারল্যাপ বা টাইম কোলিশন চেক করা
    for (const booking of existingBookings) {
      const [existStartHour, existStartMinute] = booking.startTime.split(":").map(Number);
      const existStartTotalMinutes = existStartHour * 60 + existStartMinute;
      const existEndTotalMinutes = existStartTotalMinutes + Number(booking.hours) * 60;

      // ওভারল্যাপের শর্ত: (StartA < EndB) এবং (EndA > StartB)
      const isOverlapping = 
        newStartTotalMinutes < existEndTotalMinutes && 
        newEndTotalMinutes > existStartTotalMinutes;

      if (isOverlapping) {
        return res.status(400).json({ 
          error: "This studio is already booked for the selected time slot. Please choose another time." 
        });
      }
    }

    // ৪. কোনো ওভারল্যাপ না থাকলে নতুন বুকিং সেভ করা
    const data = req.body;
    data.creatorEmail = req.user?.email || data.creatorEmail;
    data.createdAt = new Date();

    const result = await bookingCollection.insertOne(data);
    res.status(201).send(result);

  } catch (error) {
    console.error("Booking error:", error);
    res.status(500).json({ error: "Failed to create booking" });
  }
});

// Get bookings (filter by creator email or host email, Protected)
app.get('/bookings', verifyToken, async (req, res) => {
  try {
    const { creatorEmail, hostEmail } = req.query;
    let query = {};
    if (creatorEmail) query.creatorEmail = creatorEmail;
    if (hostEmail) query.hostEmail = hostEmail;

    const result = await bookingCollection.find(query).toArray();
    res.send(result);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch bookings" });
  }
});

// Update booking status (Protected)
app.patch('/bookings/:id', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ error: "Invalid Booking ID format" });
    }
    const data = req.body;
    const result = await bookingCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: data }
    );
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: "Failed to update booking status" });
  }
});

// Delete / Cancel a booking (Protected)
app.delete('/bookings/:id', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ error: "Invalid Booking ID format" });
    }
    const result = await bookingCollection.deleteOne({ _id: new ObjectId(id) });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: "Failed to delete booking" });
  }
});



// ROOT CHECK ROUTE

app.get('/', (req, res) => {
  res.send({ message: 'StudioSpace Backend Server is running fine with JWT & Wishlist Support!' });
});

app.listen(PORT, () => {
  console.log(`StudioSpace Server is running at http://localhost:${PORT}`);
});
