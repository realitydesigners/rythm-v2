import { cors } from "@elysiajs/cors";
import { swagger } from "@elysiajs/swagger";
import { Elysia } from "elysia";
import forexPreferenceRoutes from "../../../../ryver/src/api/routes/forexPreferenceRoutes";
import modelRoutes from "../../../../ryver/src/api/routes/modelRoutes";
import oandaRoutes from "../../../../ryver/src/api/routes/oandaRoutes";
import userRoutes from "../../../../ryver/src/api/routes/userRoutes";
import { WebSocketServer } from "../../../../ryver/src/services/websocketServer";

const createServer = () => {
	const app = new Elysia()
		.use(swagger())
		.use(cors())
		.use(oandaRoutes)
		.use(userRoutes)
		.use(forexPreferenceRoutes)
		.use(modelRoutes);

	return app;
};

const startServer = async () => {
	const app = createServer();

	const port = process.env.PORT || 8080;

	await app.listen(port);
	console.log(`HTTP Server is running on port ${port}`);
};

const app = createServer();
startServer();

const websocketServer = new WebSocketServer();
websocketServer.start();

export type App = typeof app;
