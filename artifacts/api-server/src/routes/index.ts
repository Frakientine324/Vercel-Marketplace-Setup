import { Router, type IRouter } from "express";
import healthRouter from "./health";
import marketplaceRouter from "./marketplace";
import storageRouter from "./storage";
import locationsRouter from "./locations";

const router: IRouter = Router();

router.use(healthRouter);
router.use(marketplaceRouter);
router.use(storageRouter);
router.use(locationsRouter);

export default router;
