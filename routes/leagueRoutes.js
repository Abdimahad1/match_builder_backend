const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/authMiddleware");
const {
  createLeague,
  getLeagues,
  getMyLeagues,
  updateLeague,
  deleteLeague,
  updateStandings,
  generateMatches,
  updateMatchResult,
  joinLeague,
  getLeagueByCode,
  bulkJoinLeague,
} = require("../controllers/leagueController");

// Import WebSocket functions (adjust path as needed)
const { broadcastToAll, broadcastToUser, broadcastToUsers } = require("../server");

// League routes
router.post("/", protect, createLeague);
router.get("/", getLeagues);
router.get("/my-leagues", protect, getMyLeagues);
router.put("/:id", protect, updateLeague);
router.delete("/:id", protect, deleteLeague);
router.post("/:leagueId/bulk-join", protect, bulkJoinLeague);

// Join and match generation
router.post("/join", protect, joinLeague);
router.get("/code/:code", getLeagueByCode);
router.post("/:id/generate-matches", protect, generateMatches);

// Extended
router.put("/:id/standings", protect, updateStandings);
router.put("/match/:matchId/result", protect, updateMatchResult);

module.exports = router;