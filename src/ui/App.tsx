import { StoreProvider } from '../storage/store'
import { useRoute } from './router'
import { HomeScreen } from './screens/HomeScreen'
import { TripScreen } from './screens/TripScreen'
import { ExpenseEditor } from './screens/ExpenseEditor'
import { SettleScreen } from './screens/SettleScreen'
import { ShareScreen } from './screens/ShareScreen'
import { PeopleScreen } from './screens/PeopleScreen'
import { ImportScreen } from './screens/ImportScreen'

export function App() {
  return (
    <StoreProvider>
      <div className="app">
        <Routes />
      </div>
    </StoreProvider>
  )
}

function Routes() {
  const route = useRoute()
  switch (route.name) {
    case 'trip':
      return <TripScreen tripId={route.tripId} />
    case 'expense':
      // `key` forces a fresh editor when switching between expenses, so the
      // form state never leaks from one expense into the next.
      return (
        <ExpenseEditor
          key={route.expenseId ?? 'new'}
          tripId={route.tripId}
          expenseId={route.expenseId}
        />
      )
    case 'settle':
      return <SettleScreen tripId={route.tripId} />
    case 'share':
      return <ShareScreen tripId={route.tripId} />
    case 'people':
      return <PeopleScreen tripId={route.tripId} />
    case 'import':
      return <ImportScreen payload={route.payload} />
    case 'home':
    default:
      return <HomeScreen />
  }
}
