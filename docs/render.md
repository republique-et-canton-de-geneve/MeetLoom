# Render demonstration

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/republique-et-canton-de-geneve/MeetLoom)

The button opens the [render.yaml](../render.yaml) Blueprint in your Render account. Review resources and confirm their creation in Render: the button deploys nothing without that action. After forking, replace the repository in the button URL with your own.

The Blueprint builds the repository's Dockerfile, starts a **Free** web service, and adds no paid database. Automatic deployments are disabled; you choose updates in the dashboard. This prevents upstream repository changes from modifying a demo installed through its button. See the [Render button documentation](https://render.com/docs/deploy-to-render).

## First launch

1. Choose the service name and confirm Blueprint creation.
2. Wait for the build and ready status, then open the service's HTTPS URL.
3. In **Render → service → Environment**, privately copy the generated `BOOTSTRAP_TOKEN` value.
4. Enter that token on MeetLoom's initial page and create your account. No default administrator password is provided.

The server derives `APP_ORIGIN` from `RENDER_EXTERNAL_URL` at startup. For a custom domain, explicitly set `APP_ORIGIN=https://your-domain.example` in Render. Render randomly generates the token when creating it; updating the Blueprint does not replace it. See [Render environment variables](https://render.com/docs/environment-variables) and the [Blueprint specification](https://render.com/docs/blueprint-spec).

## Free-plan limitations

This configuration is for **testing with disposable data**. SQLite lives in `/tmp`: accounts, agendas, and settings may disappear after a spin-down, restart, or deployment. Render spins down free services after 15 minutes without traffic, and waking up can take about a minute. Persistent disks are unavailable on this plan. Free Render PostgreSQL expires after 30 days, so it is not a durable free database alternative. Quotas and billing terms remain those of your Render account. See the [official free-plan limitations](https://render.com/docs/free).

To retain data, use persistent PostgreSQL through `DATABASE_URL` with a provider of your choice, or adapt the service to a plan with a persistent disk and point `SQLITE_PATH` to that disk. These options may cost money. For private internal data, use [OpenShift/Kubernetes deployment](deployment.md) or Docker Compose on your own infrastructure.

AI remains disabled until its endpoint is configured. A Render instance cannot automatically reach an LLM server restricted to your organization's internal network.
