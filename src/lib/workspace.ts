import { supabase } from '@/lib/supabase'
/** The database resolves membership from the verified login, never a supplied owner ID. */
export async function getWorkspaceOwner(): Promise<string> {
 const {data,error}=await supabase.rpc('my_workspace_owner' as never)
 if(error || typeof data !== 'string') throw new Error('Could not verify company access. Please sign in again.')
 return data
}
