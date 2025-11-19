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
  getCelebratingWinners,
  setLeagueWinner,
  getPreviousWinners
} = require("../controllers/leagueController");

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

// Winner celebration routes
router.get("/winners/celebrating", getCelebratingWinners);
router.post("/:leagueId/set-winner", protect, setLeagueWinner);
router.get("/:leagueId/previous-winners", getPreviousWinners);

module.exports = router;