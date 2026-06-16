const { Router } = require("express");
const { generate, list, getOne } = require("../controllers/documentController");

const router = Router();

router.post("/", generate);
router.get("/", list);
router.get("/:id", getOne);

module.exports = router;
