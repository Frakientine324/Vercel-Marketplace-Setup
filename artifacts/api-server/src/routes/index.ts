import { Router, type IRouter } from "express";
import healthRouter from "./health.js";
import marketplaceRouter from "./marketplace.js";
import storageRouter from "./storage.js";
import locationsRouter from "./locations.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use(marketplaceRouter);
router.use(storageRouter);
router.use(locationsRouter);

export default router;
