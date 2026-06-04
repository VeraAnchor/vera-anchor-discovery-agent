export type AgentServiceContext = Readonly<{
  actorRef?: string | null;
  orgRef?: string | null;
  requestId?: string | null;
  systemScope?: boolean;
}>;