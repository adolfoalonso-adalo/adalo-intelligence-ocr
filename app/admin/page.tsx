import { redirect } from "next/navigation";
import type { InputHTMLAttributes, ReactNode } from "react";
import { AdminGenerateCode } from "@/components/admin-generate-code";
import { requireAdminSession } from "@/lib/admin";
import { getPrismaClient, isDatabaseConfigured } from "@/lib/db";
import {
  createClientAction,
  revokeAccessCodeAction,
  toggleClientStatusAction,
  updateClientAction,
} from "./actions";

type AdminPlan = {
  allowJsonExport: boolean;
  dailyLimit: number;
  description: string | null;
  id: string;
  maxImageSizeMb: number;
  maxPdfSizeMb: number;
  monthlyLimit: number;
  name: string;
};

type AdminClient = {
  contactName: string | null;
  email: string | null;
  id: string;
  legalName: string | null;
  name: string;
  notes: string | null;
  plan: AdminPlan | null;
  planId: string | null;
  phone: string | null;
  profileId: string;
  status: string;
  usageEvents: { id: string }[];
};

type AdminAccessCode = {
  client: { name: string };
  codeAlias: string | null;
  displayCodePrefix: string | null;
  expiresAt: Date | null;
  id: string;
  lastUsedAt: Date | null;
  plan: { name: string };
  status: string;
};

type AdminUsageEvent = {
  client: { name: string } | null;
  createdAt: Date;
  durationMs: number | null;
  errorType: string | null;
  fields: number | null;
  id: string;
  originalFileName: string | null;
  records: number | null;
  status: string;
};

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const adminSession = await requireAdminSession();

  if (adminSession.status === "unauthenticated") {
    redirect("/login");
  }

  if (adminSession.status !== "authorized") {
    return (
      <AdminShell>
        <div className="rounded-2xl border border-brand-border bg-white p-6 text-brand-deep shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-brand-accent">Admin</p>
          <h1 className="mt-3 text-2xl font-semibold">Acceso denegado</h1>
          <p className="mt-2 text-sm text-brand-slate">
            Tu usuario de Google no esta autorizado para acceder a la administracion de ADALO OCR.
          </p>
        </div>
      </AdminShell>
    );
  }

  if (!isDatabaseConfigured()) {
    return (
      <AdminShell>
        <div className="rounded-2xl border border-brand-border bg-white p-6 text-brand-deep shadow-sm">
          <h1 className="text-2xl font-semibold">Administracion ADALO OCR</h1>
          <p className="mt-2 text-sm text-brand-slate">
            DATABASE_URL no esta configurada. Agregala en el entorno y ejecuta las migraciones para habilitar clientes,
            planes, codigos y usos.
          </p>
        </div>
      </AdminShell>
    );
  }

  const prisma = getPrismaClient();
  if (!prisma) return null;

  const today = startOfDay();
  const month = startOfMonth();
  const [clients, plans, accessCodes, usageEvents, activeClients, activeCodes, todayUsage, monthUsage, recentErrors] =
    await Promise.all([
      prisma.client.findMany({
        orderBy: { createdAt: "desc" },
        include: {
          plan: true,
          usageEvents: {
            where: { status: "success", createdAt: { gte: month } },
            select: { id: true },
          },
        },
      }),
      prisma.plan.findMany({ where: { isActive: true }, orderBy: { dailyLimit: "asc" } }),
      prisma.accessCode.findMany({
        orderBy: { createdAt: "desc" },
        take: 50,
        include: { client: true, plan: true },
      }),
      prisma.usageEvent.findMany({
        orderBy: { createdAt: "desc" },
        take: 50,
        include: { client: true },
      }),
      prisma.client.count({ where: { status: "active" } }),
      prisma.accessCode.count({ where: { status: "active" } }),
      prisma.usageEvent.count({ where: { status: "success", createdAt: { gte: today } } }),
      prisma.usageEvent.count({ where: { status: "success", createdAt: { gte: month } } }),
      prisma.usageEvent.count({ where: { status: "error", createdAt: { gte: month } } }),
    ]);

  return (
    <AdminShell>
      <div className="space-y-8">
        <header>
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-brand-accent">ADALO OCR</p>
          <h1 className="mt-2 text-3xl font-semibold text-brand-deep">Administracion manual</h1>
          <p className="mt-2 text-sm text-brand-slate">
            Clientes, codigos de acceso, planes y metadata de uso. No se almacenan archivos ni resultados completos.
          </p>
        </header>

        <section className="grid gap-3 md:grid-cols-5">
          <SummaryCard label="Clientes activos" value={activeClients} />
          <SummaryCard label="Codigos activos" value={activeCodes} />
          <SummaryCard label="Usos de hoy" value={todayUsage} />
          <SummaryCard label="Usos del mes" value={monthUsage} />
          <SummaryCard label="Errores recientes" value={recentErrors} />
        </section>

        <section className="rounded-2xl border border-brand-border bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-brand-accent">
                Codigo maestro de prueba
              </p>
              <h2 className="mt-2 text-lg font-semibold text-brand-deep">
                {isMasterAccessCodeConfigured() ? "Configurado" : "No configurado"}
              </h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-brand-slate">
                El codigo maestro permite realizar pruebas internas del OCR sin asociarlas a un plan comercial.
                No debe compartirse con clientes.
              </p>
            </div>
            <div className="rounded-xl border border-brand-border bg-brand-cream p-4 text-xs leading-5 text-brand-slate">
              <p className="font-semibold text-brand-deep">Generar hash local:</p>
              <code className="mt-1 block break-all">
                corepack pnpm hash:access-code &quot;ADALO-ADMIN-2026-TEST-XXXX&quot;
              </code>
              <p className="mt-2">Configurar el resultado en MASTER_ACCESS_CODE_HASH.</p>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-brand-border bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-brand-deep">Crear cliente</h2>
          <form action={createClientAction} className="mt-4 grid gap-3 md:grid-cols-3">
            <Input name="name" placeholder="Nombre comercial" required />
            <Input name="legalName" placeholder="Razon social" />
            <Input name="email" placeholder="Email" type="email" />
            <Input name="contactName" placeholder="Contacto" />
            <Input name="phone" placeholder="Telefono" />
            <select name="profileId" className={fieldClassName}>
              <option value="internal-general">Deteccion automatica</option>
              <option value="internal-dtve-senasa-arca">Restringir a DTVe / SENASA / ARCA</option>
              <option value="internal-movimiento-camiones">Restringir a movimiento de camiones</option>
              <option value="internal-nomina-personal">Restringir a nomina de personal</option>
              <option value="internal-tabla-administrativa">Restringir a tabla administrativa</option>
            </select>
            <select name="planId" className={fieldClassName}>
              <option value="">Sin plan</option>
              {plans.map((plan: AdminPlan) => (
                <option key={plan.id} value={plan.id}>
                  {plan.name}
                </option>
              ))}
            </select>
            <select name="status" className={fieldClassName}>
              <option value="active">active</option>
              <option value="inactive">inactive</option>
            </select>
            <Input name="notes" placeholder="Notas" />
            <button className="rounded-xl bg-brand-deep px-4 py-2 text-sm font-semibold text-white md:col-span-3">
              Crear cliente
            </button>
          </form>
        </section>

        <DataSection title="Clientes">
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-brand-slate">
                <tr>
                  <Th>Nombre</Th>
                  <Th>Email</Th>
                  <Th>Perfil</Th>
                  <Th>Estado</Th>
                  <Th>Plan</Th>
                  <Th>Usos del mes</Th>
                  <Th>Acciones</Th>
                </tr>
              </thead>
              <tbody>
                {clients.map((client: AdminClient) => (
                  <tr key={client.id} className="border-t border-brand-border">
                    <Td>{client.name}</Td>
                    <Td>{client.email || "-"}</Td>
                    <Td>{client.profileId}</Td>
                    <Td>{client.status}</Td>
                    <Td>{client.plan?.name || "-"}</Td>
                    <Td>{client.usageEvents.length}</Td>
                    <Td>
                      <div className="space-y-3">
                        <AdminGenerateCode clientId={client.id} defaultPlanId={client.planId} plans={plans} />
                        <details className="rounded-xl border border-brand-border bg-brand-cream p-3">
                          <summary className="cursor-pointer text-xs font-semibold text-brand-deep">
                            Editar cliente
                          </summary>
                          <form action={updateClientAction} className="mt-3 grid gap-2">
                            <input type="hidden" name="clientId" value={client.id} />
                            <Input name="name" defaultValue={client.name} placeholder="Nombre comercial" required />
                            <Input name="legalName" defaultValue={client.legalName ?? ""} placeholder="Razon social" />
                            <Input name="email" defaultValue={client.email ?? ""} placeholder="Email" type="email" />
                            <Input name="contactName" defaultValue={client.contactName ?? ""} placeholder="Contacto" />
                            <Input name="phone" defaultValue={client.phone ?? ""} placeholder="Telefono" />
                            <select name="profileId" defaultValue={client.profileId} className={fieldClassName}>
                              <option value="internal-general">Deteccion automatica</option>
                              <option value="internal-dtve-senasa-arca">Restringir a DTVe / SENASA / ARCA</option>
                              <option value="internal-movimiento-camiones">Restringir a movimiento de camiones</option>
                              <option value="internal-nomina-personal">Restringir a nomina de personal</option>
                              <option value="internal-tabla-administrativa">Restringir a tabla administrativa</option>
                            </select>
                            <select name="planId" defaultValue={client.planId ?? ""} className={fieldClassName}>
                              <option value="">Sin plan</option>
                              {plans.map((plan: AdminPlan) => (
                                <option key={plan.id} value={plan.id}>
                                  {plan.name}
                                </option>
                              ))}
                            </select>
                            <select name="status" defaultValue={client.status} className={fieldClassName}>
                              <option value="active">active</option>
                              <option value="inactive">inactive</option>
                              <option value="suspended">suspended</option>
                            </select>
                            <Input name="notes" defaultValue={client.notes ?? ""} placeholder="Notas" />
                            <button className="rounded-xl bg-brand-deep px-3 py-2 text-xs font-semibold text-white">
                              Guardar cambios
                            </button>
                          </form>
                        </details>
                        <form action={toggleClientStatusAction} className="flex gap-2">
                          <input type="hidden" name="clientId" value={client.id} />
                          <input
                            type="hidden"
                            name="status"
                            value={client.status === "active" ? "inactive" : "active"}
                          />
                          <button className="text-xs font-semibold text-brand-accent">
                            {client.status === "active" ? "Desactivar" : "Activar"}
                          </button>
                        </form>
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </DataSection>

        <DataSection title="Codigos de acceso">
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-brand-slate">
                <tr>
                  <Th>Cliente</Th>
                  <Th>Codigo/Alias</Th>
                  <Th>Plan</Th>
                  <Th>Estado</Th>
                  <Th>Vencimiento</Th>
                  <Th>Ultimo uso</Th>
                  <Th>Acciones</Th>
                </tr>
              </thead>
              <tbody>
                {accessCodes.map((code: AdminAccessCode) => (
                  <tr key={code.id} className="border-t border-brand-border">
                    <Td>{code.client.name}</Td>
                    <Td>{code.displayCodePrefix || code.codeAlias || "-"}</Td>
                    <Td>{code.plan.name}</Td>
                    <Td>{code.status}</Td>
                    <Td>{formatDate(code.expiresAt)}</Td>
                    <Td>{formatDate(code.lastUsedAt)}</Td>
                    <Td>
                      <form action={revokeAccessCodeAction}>
                        <input type="hidden" name="accessCodeId" value={code.id} />
                        <button className="text-xs font-semibold text-red-700">Revocar</button>
                      </form>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </DataSection>

        <DataSection title="Planes">
          <div className="grid gap-3 md:grid-cols-5">
            {plans.map((plan: AdminPlan) => (
              <div key={plan.id} className="rounded-xl border border-brand-border bg-brand-cream p-4 text-sm">
                <p className="font-semibold text-brand-deep">{plan.name}</p>
                <p className="mt-1 text-xs text-brand-slate">{plan.description}</p>
                <p className="mt-3 text-xs text-brand-slate">Diario: {plan.dailyLimit}</p>
                <p className="text-xs text-brand-slate">Mensual: {plan.monthlyLimit}</p>
                <p className="text-xs text-brand-slate">PDF: {plan.maxPdfSizeMb} MB</p>
                <p className="text-xs text-brand-slate">Imagen: {plan.maxImageSizeMb} MB</p>
                <p className="text-xs text-brand-slate">JSON: {plan.allowJsonExport ? "Si" : "No"}</p>
              </div>
            ))}
          </div>
        </DataSection>

        <DataSection title="Uso reciente">
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-brand-slate">
                <tr>
                  <Th>Fecha</Th>
                  <Th>Cliente</Th>
                  <Th>Archivo</Th>
                  <Th>Estado</Th>
                  <Th>Registros</Th>
                  <Th>Campos</Th>
                  <Th>Duracion</Th>
                  <Th>Error</Th>
                </tr>
              </thead>
              <tbody>
                {usageEvents.map((event: AdminUsageEvent) => (
                  <tr key={event.id} className="border-t border-brand-border">
                    <Td>{formatDate(event.createdAt)}</Td>
                    <Td>{event.client?.name || "-"}</Td>
                    <Td>{event.originalFileName || "-"}</Td>
                    <Td>{event.status}</Td>
                    <Td>{event.records ?? "-"}</Td>
                    <Td>{event.fields ?? "-"}</Td>
                    <Td>{event.durationMs ? `${(event.durationMs / 1000).toFixed(1)} s` : "-"}</Td>
                    <Td>{event.errorType || "-"}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </DataSection>
      </div>
    </AdminShell>
  );
}

const fieldClassName = "rounded-xl border border-brand-border bg-white px-3 py-2 text-sm text-brand-deep";

function AdminShell({ children }: { children: ReactNode }) {
  return <main className="min-h-screen bg-brand-cream px-4 py-8 md:px-8">{children}</main>;
}

function SummaryCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-brand-border bg-white p-4 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-brand-slate">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-brand-deep">{value}</p>
    </div>
  );
}

function DataSection({ children, title }: { children: ReactNode; title: string }) {
  return (
    <section className="rounded-2xl border border-brand-border bg-white p-5 shadow-sm">
      <h2 className="text-lg font-semibold text-brand-deep">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={fieldClassName} />;
}

function Th({ children }: { children: ReactNode }) {
  return <th className="whitespace-nowrap px-3 py-2 font-semibold">{children}</th>;
}

function Td({ children }: { children: ReactNode }) {
  return <td className="align-top px-3 py-3 text-brand-deep">{children}</td>;
}

function formatDate(date?: Date | null) {
  if (!date) return "-";
  return new Intl.DateTimeFormat("es-AR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

function startOfDay() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
}

function startOfMonth() {
  const date = new Date();
  date.setDate(1);
  date.setHours(0, 0, 0, 0);
  return date;
}

function isMasterAccessCodeConfigured() {
  return Boolean(process.env.MASTER_ACCESS_CODE_HASH?.trim());
}
