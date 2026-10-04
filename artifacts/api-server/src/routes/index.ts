import { Router, type IRouter } from "express";
import authRouter from "./auth";
import healthRouter from "./health";
import locationsRouter from "./locations";
import marketplaceRouter from "./marketplace";
import storageRouter from "./storage";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(locationsRouter);
router.use(marketplaceRouter);
router.use(storageRouter);

export default router;
