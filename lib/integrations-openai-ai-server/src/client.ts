import OpenAI from "openai";
import { getOpenAIClientConfig } from "./client-config";

export const openai = new OpenAI(getOpenAIClientConfig());
