import { CustomerForm } from "../../_components/CustomerForm"

export default function EditCustomerPage({
  params,
}: {
  params: Promise<{ customer_id: string }>
}) {
  return <CustomerForm mode="edit" customerIdParam={params} />
}
