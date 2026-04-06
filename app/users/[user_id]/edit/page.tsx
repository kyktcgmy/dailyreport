import { UserForm } from "../../_components/UserForm"

export default function EditUserPage({
  params,
}: {
  params: Promise<{ user_id: string }>
}) {
  return <UserForm mode="edit" userIdParam={params} />
}
