import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { Empty } from "@/ui/display";

export default function NotFound() {
  const { t } = useTranslation();
  return (
    <div className="page">
      <Empty icon="search" title={t("notFound.title")} action={<Link className="btn primary" to="/">{t("nav.home")}</Link>}>{t("notFound.body")}</Empty>
    </div>
  );
}
