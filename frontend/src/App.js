import './App.css';
import ReviewWidget from './ReviewWidget';

function App() {
  const exampleProductId = "8352823935137"; 

  return (
    <div className="App">
      <h1>My Review Widget</h1>
      <ReviewWidget productId={exampleProductId} />
    </div>
  );
}

export default App;
